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

interface FakeTestInfo {
  file: string;
  config: { rootDir: string };
  titlePath: string[];
  annotations: Annotation[];
}

function makeTestInfo(overrides: Partial<FakeTestInfo> = {}): FakeTestInfo {
  return {
    file: '/repo/tests/login.spec.ts',
    config: { rootDir: '/repo' },
    titlePath: ['', 'chromium', 'login.spec.ts', 'Auth', 'bad test'],
    annotations: [],
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
  });

  it('pushes quarantined annotation when test id is in the list', async () => {
    writeStateFile(
      {
        testRunId: 'abc',
        quarantineList: ['tests/login.spec.ts > Auth > bad test'],
      },
      workDir
    );
    const testInfo = makeTestInfo();
    await fixtureFn({}, async () => {}, testInfo);
    expect(testInfo.annotations).toEqual([
      {
        type: QUARANTINED_ANNOTATION,
        description: 'tests/login.spec.ts > Auth > bad test',
      },
    ]);
  });

  it('does not annotate tests that are not on the quarantine list', async () => {
    writeStateFile({ testRunId: 'abc', quarantineList: ['other.spec.ts > x'] }, workDir);
    const testInfo = makeTestInfo();
    await fixtureFn({}, async () => {}, testInfo);
    expect(testInfo.annotations).toEqual([]);
  });

  it('re-throws errors for non-quarantined tests', async () => {
    writeStateFile({ testRunId: 'abc', quarantineList: [] }, workDir);
    const testInfo = makeTestInfo();
    const err = new Error('boom');
    await expect(
      fixtureFn(
        {},
        async () => {
          throw err;
        },
        testInfo
      )
    ).rejects.toBe(err);
  });

  it('swallows errors for quarantined tests and records absorbed annotation', async () => {
    writeStateFile(
      {
        testRunId: 'abc',
        quarantineList: ['tests/login.spec.ts > Auth > bad test'],
      },
      workDir
    );
    const testInfo = makeTestInfo();
    const err = new Error('flaky failure');
    err.stack = 'Error: flaky failure\n    at anon';

    await fixtureFn(
      {},
      async () => {
        throw err;
      },
      testInfo
    );

    expect(testInfo.annotations.map((a) => a.type)).toEqual([
      QUARANTINED_ANNOTATION,
      QUARANTINED_ABSORBED_ANNOTATION,
    ]);
    const absorbed = testInfo.annotations.find((a) => a.type === QUARANTINED_ABSORBED_ANNOTATION);
    const payload = JSON.parse(absorbed!.description!);
    expect(payload.name).toBe('Error');
    expect(payload.message).toBe('flaky failure');
    expect(payload.stack).toContain('Error: flaky failure');
  });
});
