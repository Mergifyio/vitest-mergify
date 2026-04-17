import { createRequire } from 'node:module';
import {
  type TracingContext,
  createTracing,
  envToBool,
  generateTestRunId,
  getRepositoryNameFromUrl,
  git,
  isInCI,
} from '@mergifyio/ci-core';
import { type Span, SpanStatusCode, context, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { QUARANTINED_ABSORBED_ANNOTATION, QUARANTINED_ANNOTATION } from './fixture.js';
import * as playwrightResource from './resources/playwright.js';
import { loadState } from './state-file.js';
import { buildCanonicalId, extractNamespace, toRelativePath } from './test-id.js';
import type { MergifyReporterOptions, TestSpanInfo } from './types.js';

const DEFAULT_API_URL = 'https://api.mergify.com';

function getRepoName(): string | undefined {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  if (process.env.GIT_URL) {
    return getRepositoryNameFromUrl(process.env.GIT_URL) ?? undefined;
  }
  const remoteUrl = git('config', '--get', 'remote.origin.url');
  if (remoteUrl) return getRepositoryNameFromUrl(remoteUrl) ?? undefined;
  return undefined;
}

function getPlaywrightVersion(): string {
  try {
    const req = createRequire(import.meta.url);
    return (req('@playwright/test/package.json') as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[@mergifyio/playwright] ${msg}`);
}

function mapStatus(status: TestResult['status']): 'passed' | 'failed' | 'skipped' {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'skipped':
      return 'skipped';
    // failed, timedOut, interrupted all collapse into "failed"
    default:
      return 'failed';
  }
}

function readAnnotations(test: TestCase): TestSpanInfo {
  const info: TestSpanInfo = { quarantined: false };
  for (const ann of test.annotations) {
    if (ann.type === QUARANTINED_ANNOTATION) {
      info.quarantined = true;
    } else if (ann.type === QUARANTINED_ABSORBED_ANNOTATION) {
      info.quarantined = true;
      try {
        info.absorbedError = JSON.parse(ann.description ?? '{}');
      } catch {
        info.absorbedError = { name: 'Error', message: '', stack: '' };
      }
    }
  }
  return info;
}

/** Pick the final (last) TestResult from a test's attempts. */
function finalResult(test: TestCase): TestResult | undefined {
  if (test.results.length === 0) return undefined;
  return test.results[test.results.length - 1];
}

export class MergifyReporter implements Reporter {
  private options: MergifyReporterOptions;
  private tracing: TracingContext | null = null;
  private sessionSpan: Span | undefined;
  private config: FullConfig | undefined;
  private rootSuite: Suite | undefined;
  private quarantinedCaught: string[] = [];
  private quarantineListSize = 0;
  private testRunId: string | undefined;
  private startedViaState = false;

  constructor(options?: MergifyReporterOptions) {
    this.options = options ?? {};
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.rootSuite = suite;

    const state = loadState();
    if (state) {
      this.testRunId = state.testRunId;
      this.quarantineListSize = state.quarantineList.length;
      this.startedViaState = true;
    } else {
      this.testRunId = generateTestRunId();
    }

    const token = this.options.token ?? process.env.MERGIFY_TOKEN;
    const apiUrl = this.options.apiUrl ?? process.env.MERGIFY_API_URL ?? DEFAULT_API_URL;
    const repoName = getRepoName();

    const enabled =
      isInCI() ||
      envToBool(process.env.PLAYWRIGHT_MERGIFY_ENABLE, false) ||
      !!this.options.exporter;

    if (!enabled) return;

    this.tracing = createTracing({
      token,
      repoName,
      apiUrl,
      testRunId: this.testRunId,
      frameworkAttributes: playwrightResource.detect(getPlaywrightVersion()),
      tracerName: '@mergifyio/playwright',
      exporter: this.options.exporter,
    });

    if (!this.tracing) {
      if (!token) {
        log('MERGIFY_TOKEN not set, skipping CI Insights reporting');
      } else if (!repoName) {
        log('Could not detect repository name, skipping CI Insights reporting');
      }
      return;
    }

    let parentContext = context.active();
    const traceparent = process.env.MERGIFY_TRACEPARENT;
    if (traceparent) {
      const propagator = new W3CTraceContextPropagator();
      parentContext = propagator.extract(
        context.active(),
        { traceparent },
        {
          get(c: Record<string, string>, key: string) {
            return c[key];
          },
          keys(c: Record<string, string>) {
            return Object.keys(c);
          },
        }
      );
    }

    this.sessionSpan = this.tracing.tracer.startSpan(
      'playwright session start',
      { attributes: { 'test.scope': 'session' } },
      parentContext
    );
  }

  private emitTestSpan(test: TestCase, result: TestResult): void {
    if (!this.tracing || !this.sessionSpan || !this.config) return;

    const rootDir = this.config.rootDir;
    const canonicalId = buildCanonicalId({
      filePath: test.location.file,
      rootDir,
      titlePath: test.titlePath(),
    });
    const namespace = extractNamespace({
      filePath: test.location.file,
      rootDir,
      titlePath: test.titlePath(),
    });
    const info = readAnnotations(test);
    if (info.quarantined && info.absorbedError) {
      this.quarantinedCaught.push(canonicalId);
    }

    const startTimeMs = result.startTime.getTime();
    const endTimeMs = startTimeMs + result.duration;

    const parentCtx = trace.setSpan(context.active(), this.sessionSpan);
    const status = mapStatus(result.status);
    const effectivelyFailed = status === 'failed' || !!info.absorbedError;

    const relFilePath = toRelativePath(test.location.file, rootDir);

    const span = this.tracing.tracer.startSpan(
      canonicalId,
      {
        attributes: {
          'test.scope': 'case',
          'test.case.result.status': status,
          'code.filepath': relFilePath,
          'code.function': test.title,
          'code.lineno': test.location.line,
          'code.namespace': namespace,
          'code.file.path': test.location.file,
          'code.line.number': test.location.line,
          'cicd.test.quarantined': info.quarantined,
          'cicd.test.retry_count': result.retry,
          'cicd.test.flaky': test.outcome() === 'flaky',
        },
        startTime: startTimeMs,
      },
      parentCtx
    );

    if (effectivelyFailed) {
      const err = info.absorbedError ?? extractError(result);
      if (err) {
        span.setAttributes({
          'exception.type': err.name,
          'exception.message': err.message,
          'exception.stacktrace': err.stack,
        });
      }
      span.setStatus({ code: SpanStatusCode.ERROR });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end(endTimeMs);
  }

  async onEnd(result: FullResult): Promise<void> {
    if (this.rootSuite) {
      for (const test of this.rootSuite.allTests()) {
        const last = finalResult(test);
        if (last) this.emitTestSpan(test, last);
      }
    }

    if (this.sessionSpan) {
      this.sessionSpan.setStatus({
        code: result.status === 'passed' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      });
      this.sessionSpan.end();
    }

    if (this.tracing) {
      try {
        await this.tracing.tracerProvider.forceFlush();
      } catch (err) {
        log(`Failed to flush spans: ${String(err)}`);
      }
      if (this.tracing.ownsExporter) {
        try {
          await this.tracing.tracerProvider.shutdown();
        } catch {
          // ignore
        }
      }
    }

    this.printReport();
  }

  private printReport(): void {
    if (!this.startedViaState && !this.tracing) return;

    // eslint-disable-next-line no-console
    console.log('');
    // eslint-disable-next-line no-console
    console.log('[@mergifyio/playwright] Quarantine report:');
    // eslint-disable-next-line no-console
    console.log(`  Quarantined tests fetched: ${this.quarantineListSize}`);

    if (this.quarantinedCaught.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `  Quarantined tests caught (failures absorbed): ${this.quarantinedCaught.length}`
      );
      for (const name of this.quarantinedCaught) {
        // eslint-disable-next-line no-console
        console.log(`    - ${name}`);
      }
    }

    const unused = this.quarantineListSize - this.quarantinedCaught.length;
    if (unused > 0) {
      // eslint-disable-next-line no-console
      console.log(`  Unused quarantine entries: ${unused}`);
    }

    if (this.testRunId) {
      // eslint-disable-next-line no-console
      console.log(`MERGIFY_TEST_RUN_ID=${this.testRunId}`);
    }
  }

  // Exposed for tests.
  getExporter() {
    return this.tracing?.exporter;
  }
}

function extractError(
  result: TestResult
): { name: string; message: string; stack: string } | undefined {
  const first = result.errors[0] ?? result.error;
  if (!first) return undefined;
  return {
    name: 'Error',
    message: first.message ?? '',
    stack: first.stack ?? '',
  };
}

export default MergifyReporter;
