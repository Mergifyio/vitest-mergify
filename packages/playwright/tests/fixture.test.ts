import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  QUARANTINED_ABSORBED_ANNOTATION,
  QUARANTINED_ANNOTATION,
  _resetStateCache,
  mergifyFixture,
} from '../src/fixture.js';
import { STATE_FILE_ENV, writeStateFile } from '../src/state-file.js';

type Annotation = { type: string; description?: string };
type TestError = { message?: string; stack?: string };

interface FakeTestInfo {
  file: string;
  config: { rootDir: string };
  titlePath: string[];
  annotations: Annotation[];
  errors: TestError[];
  expectedStatus: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
}

function makeTestInfo(overrides: Partial<FakeTestInfo> = {}): FakeTestInfo {
  return {
    file: '/repo/tests/login.spec.ts',
    config: { rootDir: '/repo/tests' },
    // Playwright's testInfo.titlePath: [fileBasename, ...describes, testTitle]
    titlePath: ['login.spec.ts', 'Auth', 'bad test'],
    annotations: [],
    errors: [],
    expectedStatus: 'passed',
    ...overrides,
  };
}

// The fixture is declared as `[asyncFn, options]`; extract the function.
// biome-ignore lint/suspicious/noExplicitAny: unit-test shim
const fixtureFn = (mergifyFixture._mergifyQuarantine as any)[0] as (
  deps: Record<string, never>,
  use: (v?: unknown) => Promise<void>,
  testInfo: FakeTestInfo
) => Promise<void>;

const QUARANTINED_ID = 'login.spec.ts > Auth > bad test';

describe('mergifyFixture', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'mergify-pw-fixture-'));
    delete process.env[STATE_FILE_ENV];
    _resetStateCache();
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    delete process.env[STATE_FILE_ENV];
    _resetStateCache();
  });

  it('is a no-op when no state file is present', async () => {
    const testInfo = makeTestInfo();
    let ran = false;
    await fixtureFn(
      {},
      async () => {
        ran = true;
      },
      testInfo
    );
    expect(ran).toBe(true);
    expect(testInfo.annotations).toEqual([]);
    expect(testInfo.expectedStatus).toBe('passed');
  });

  it('pushes quarantined annotation when test id is in the list and test passes', async () => {
    writeStateFile({ testRunId: 'abc', quarantineList: [QUARANTINED_ID] }, workDir);
    const testInfo = makeTestInfo();
    await fixtureFn({}, async () => {}, testInfo);
    expect(testInfo.annotations).toEqual([
      { type: QUARANTINED_ANNOTATION, description: QUARANTINED_ID },
    ]);
    // Healthy quarantined test: expectedStatus stays 'passed' so the test
    // still reports as passing.
    expect(testInfo.expectedStatus).toBe('passed');
  });

  it('does not annotate tests that are not on the quarantine list', async () => {
    writeStateFile({ testRunId: 'abc', quarantineList: ['other.spec.ts > x'] }, workDir);
    const testInfo = makeTestInfo();
    await fixtureFn({}, async () => {}, testInfo);
    expect(testInfo.annotations).toEqual([]);
    expect(testInfo.expectedStatus).toBe('passed');
  });

  it('flips expectedStatus to failed for quarantined tests that actually failed', async () => {
    writeStateFile({ testRunId: 'abc', quarantineList: [QUARANTINED_ID] }, workDir);
    // Simulate Playwright recording a test-body error before fixture teardown.
    const testInfo = makeTestInfo({
      errors: [{ message: 'expected 1 to equal 2', stack: 'AssertionError: ...\n  at x' }],
    });
    await fixtureFn({}, async () => {}, testInfo);

    expect(testInfo.annotations.map((a) => a.type)).toEqual([
      QUARANTINED_ANNOTATION,
      QUARANTINED_ABSORBED_ANNOTATION,
    ]);
    const absorbed = testInfo.annotations.find((a) => a.type === QUARANTINED_ABSORBED_ANNOTATION);
    const payload = JSON.parse(absorbed?.description ?? '{}');
    expect(payload.message).toBe('expected 1 to equal 2');

    // Playwright will now reconcile actual=failed vs expected=failed → OK.
    expect(testInfo.expectedStatus).toBe('failed');
  });

  it('leaves non-quarantined failures alone (no expectedStatus flip)', async () => {
    writeStateFile({ testRunId: 'abc', quarantineList: ['other.spec.ts > x'] }, workDir);
    const testInfo = makeTestInfo({
      errors: [{ message: 'boom', stack: 'Error: boom' }],
    });
    await fixtureFn({}, async () => {}, testInfo);
    expect(testInfo.annotations).toEqual([]);
    expect(testInfo.expectedStatus).toBe('passed');
  });
});
