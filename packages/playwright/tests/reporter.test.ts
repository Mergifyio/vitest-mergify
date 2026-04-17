import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUARANTINED_ABSORBED_ANNOTATION, QUARANTINED_ANNOTATION } from '../src/fixture.js';
import { MergifyReporter } from '../src/reporter.js';
import { STATE_FILE_ENV, writeStateFile } from '../src/state-file.js';

// Minimal structural stubs for Playwright reporter types — just enough for the reporter.
interface StubAnnotation {
  type: string;
  description?: string;
}
interface StubTestResult {
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  startTime: Date;
  duration: number;
  retry: number;
  errors: { message?: string; stack?: string }[];
  error?: { message?: string; stack?: string };
}
interface StubTestCase {
  title: string;
  location: { file: string; line: number; column: number };
  annotations: StubAnnotation[];
  results: StubTestResult[];
  titlePath(): string[];
  outcome(): 'expected' | 'unexpected' | 'flaky' | 'skipped';
}
interface StubSuite {
  allTests(): StubTestCase[];
}
interface StubFullConfig {
  rootDir: string;
}

function makeTest(args: {
  file: string;
  rootDir: string;
  titlePath: string[];
  title: string;
  status: StubTestResult['status'];
  retry?: number;
  error?: { message: string; stack: string };
  annotations?: StubAnnotation[];
}): StubTestCase {
  const result: StubTestResult = {
    status: args.status,
    startTime: new Date(1_700_000_000_000),
    duration: 42,
    retry: args.retry ?? 0,
    errors: args.error ? [args.error] : [],
    error: args.error,
  };
  const outcome =
    args.status === 'passed' ? 'expected' : args.status === 'skipped' ? 'skipped' : 'unexpected';
  return {
    title: args.title,
    location: { file: args.file, line: 10, column: 1 },
    annotations: args.annotations ?? [],
    results: [result],
    titlePath: () => args.titlePath,
    outcome: () => outcome as 'expected' | 'unexpected',
  };
}

describe('MergifyReporter', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'mergify-pw-reporter-'));
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('GITHUB_REPOSITORY', 'test-owner/test-repo');
    vi.stubEnv('CI', 'true');
    delete process.env[STATE_FILE_ENV];
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    delete process.env[STATE_FILE_ENV];
  });

  it('emits a session span and a per-test span for a passing test', async () => {
    const exporter = new InMemorySpanExporter();
    const reporter = new MergifyReporter({ exporter });
    writeStateFile({ testRunId: 'deadbeefdeadbeef', quarantineList: [] }, workDir);

    const test = makeTest({
      file: '/repo/tests/smoke.spec.ts',
      rootDir: '/repo',
      titlePath: ['', 'chromium', 'smoke.spec.ts', 'works'],
      title: 'works',
      status: 'passed',
    });
    const suite: StubSuite = { allTests: () => [test] };
    const config: StubFullConfig = { rootDir: '/repo' };

    reporter.onBegin(config as never, suite as never);
    await reporter.onEnd({ status: 'passed' } as never);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);

    const sessionSpan = spans.find((s) => s.attributes['test.scope'] === 'session');
    const testSpan = spans.find((s) => s.attributes['test.scope'] === 'case');
    expect(sessionSpan?.name).toBe('playwright session start');
    expect(testSpan?.name).toBe('tests/smoke.spec.ts > works');
    expect(testSpan?.attributes['test.case.result.status']).toBe('passed');
    expect(testSpan?.attributes['code.filepath']).toBe('tests/smoke.spec.ts');
    expect(testSpan?.attributes['code.function']).toBe('works');
    expect(testSpan?.attributes['cicd.test.quarantined']).toBe(false);
    expect(testSpan?.parentSpanId).toBe(sessionSpan?.spanContext().spanId);
  });

  it('records exception attributes for a failing test', async () => {
    const exporter = new InMemorySpanExporter();
    const reporter = new MergifyReporter({ exporter });
    writeStateFile({ testRunId: 'deadbeefdeadbeef', quarantineList: [] }, workDir);

    const test = makeTest({
      file: '/repo/bad.spec.ts',
      rootDir: '/repo',
      titlePath: ['', 'chromium', 'bad.spec.ts', 'breaks'],
      title: 'breaks',
      status: 'failed',
      error: { message: 'expected 1 to equal 2', stack: 'Error: ...\n at bad.spec.ts:11' },
    });
    const suite: StubSuite = { allTests: () => [test] };

    reporter.onBegin({ rootDir: '/repo' } as never, suite as never);
    await reporter.onEnd({ status: 'failed' } as never);

    const testSpan = exporter.getFinishedSpans().find((s) => s.attributes['test.scope'] === 'case');
    expect(testSpan?.attributes['test.case.result.status']).toBe('failed');
    expect(testSpan?.attributes['exception.message']).toBe('expected 1 to equal 2');
    expect(testSpan?.attributes['exception.stacktrace']).toContain('bad.spec.ts:11');
  });

  it('marks quarantined-absorbed test as quarantined with exception attrs', async () => {
    const exporter = new InMemorySpanExporter();
    const reporter = new MergifyReporter({ exporter });
    writeStateFile(
      { testRunId: 'deadbeefdeadbeef', quarantineList: ['q.spec.ts > flaky'] },
      workDir
    );

    // Playwright reports these as "passed" because the fixture swallowed; the
    // absorbed annotation carries the real error so the trace retains it.
    const test = makeTest({
      file: '/repo/q.spec.ts',
      rootDir: '/repo',
      titlePath: ['', 'chromium', 'q.spec.ts', 'flaky'],
      title: 'flaky',
      status: 'passed',
      annotations: [
        { type: QUARANTINED_ANNOTATION, description: 'q.spec.ts > flaky' },
        {
          type: QUARANTINED_ABSORBED_ANNOTATION,
          description: JSON.stringify({
            name: 'AssertionError',
            message: 'something broke',
            stack: 'trace line',
          }),
        },
      ],
    });
    const suite: StubSuite = { allTests: () => [test] };

    reporter.onBegin({ rootDir: '/repo' } as never, suite as never);
    await reporter.onEnd({ status: 'passed' } as never);

    const testSpan = exporter.getFinishedSpans().find((s) => s.attributes['test.scope'] === 'case');
    expect(testSpan?.attributes['cicd.test.quarantined']).toBe(true);
    expect(testSpan?.attributes['test.case.result.status']).toBe('passed');
    // The actual exception is still captured on the span for the backend.
    expect(testSpan?.attributes['exception.type']).toBe('AssertionError');
    expect(testSpan?.attributes['exception.message']).toBe('something broke');
  });

  it('normalizes malformed absorbed-error payloads to string defaults', async () => {
    const exporter = new InMemorySpanExporter();
    const reporter = new MergifyReporter({ exporter });
    writeStateFile(
      { testRunId: 'deadbeefdeadbeef', quarantineList: ['q.spec.ts > flaky'] },
      workDir
    );

    const test = makeTest({
      file: '/repo/q.spec.ts',
      rootDir: '/repo',
      titlePath: ['', 'chromium', 'q.spec.ts', 'flaky'],
      title: 'flaky',
      status: 'passed',
      annotations: [
        { type: QUARANTINED_ANNOTATION, description: 'q.spec.ts > flaky' },
        // Partial payload: name missing, stack wrong type — must not leak `undefined`
        // into OTel attributes.
        {
          type: QUARANTINED_ABSORBED_ANNOTATION,
          description: JSON.stringify({ message: 'boom', stack: 42 }),
        },
      ],
    });
    const suite: StubSuite = { allTests: () => [test] };

    reporter.onBegin({ rootDir: '/repo' } as never, suite as never);
    await reporter.onEnd({ status: 'passed' } as never);

    const testSpan = exporter.getFinishedSpans().find((s) => s.attributes['test.scope'] === 'case');
    expect(testSpan?.attributes['exception.type']).toBe('Error');
    expect(testSpan?.attributes['exception.message']).toBe('boom');
    expect(testSpan?.attributes['exception.stacktrace']).toBe('');
  });

  it('uses the testRunId from the state file when present', async () => {
    const exporter = new InMemorySpanExporter();
    const reporter = new MergifyReporter({ exporter });
    writeStateFile({ testRunId: 'abcdef0123456789', quarantineList: [] }, workDir);
    const suite: StubSuite = { allTests: () => [] };

    reporter.onBegin({ rootDir: '/repo' } as never, suite as never);
    await reporter.onEnd({ status: 'passed' } as never);

    const sessionSpan = exporter
      .getFinishedSpans()
      .find((s) => s.attributes['test.scope'] === 'session');
    expect(sessionSpan?.resource.attributes['test.run.id']).toBe('abcdef0123456789');
  });

  it('includes framework + ci resource attributes', async () => {
    const exporter = new InMemorySpanExporter();
    const reporter = new MergifyReporter({ exporter });
    writeStateFile({ testRunId: 'abc', quarantineList: [] }, workDir);
    const suite: StubSuite = { allTests: () => [] };

    reporter.onBegin({ rootDir: '/repo' } as never, suite as never);
    await reporter.onEnd({ status: 'passed' } as never);

    const sessionSpan = exporter
      .getFinishedSpans()
      .find((s) => s.attributes['test.scope'] === 'session');
    const attrs = sessionSpan!.resource.attributes;
    expect(attrs['test.framework']).toBe('playwright');
    expect(attrs['test.framework.version']).toBeTruthy();
    expect(attrs['cicd.provider.name']).toBe('github_actions');
    expect(attrs['vcs.repository.name']).toBe('test-owner/test-repo');
  });
});
