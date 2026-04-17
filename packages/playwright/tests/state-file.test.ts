import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STATE_FILE_ENV,
  loadState,
  readStateFile,
  removeStateFile,
  stateFilePath,
  writeStateFile,
} from '../src/state-file.js';

describe('state-file', () => {
  let workDir: string;
  const savedEnv = process.env[STATE_FILE_ENV];

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'mergify-pw-state-'));
    delete process.env[STATE_FILE_ENV];
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    if (savedEnv !== undefined) {
      process.env[STATE_FILE_ENV] = savedEnv;
    } else {
      delete process.env[STATE_FILE_ENV];
    }
  });

  it('computes path under node_modules/.cache/@mergifyio/playwright', () => {
    const p = stateFilePath('abc123', workDir);
    expect(p).toBe(
      join(workDir, 'node_modules', '.cache', '@mergifyio', 'playwright', 'state-abc123.json')
    );
  });

  it('round-trips state through write / readStateFile', () => {
    const state = {
      testRunId: 'deadbeefdeadbeef',
      quarantineList: ['a.spec.ts > bad test', 'b.spec.ts > other'],
    };
    const path = writeStateFile(state, workDir);
    expect(existsSync(path)).toBe(true);
    expect(readStateFile(path)).toEqual(state);
  });

  it('sets MERGIFY_PLAYWRIGHT_STATE_FILE env so loadState can find it', () => {
    const state = { testRunId: 'x', quarantineList: [] };
    writeStateFile(state, workDir);
    expect(process.env[STATE_FILE_ENV]).toBeTruthy();
    expect(loadState()).toEqual(state);
  });

  it('loadState returns null when env unset', () => {
    expect(loadState()).toBeNull();
  });

  it('removeStateFile is a no-op when file absent', () => {
    expect(() => removeStateFile('/tmp/does-not-exist-xyz.json')).not.toThrow();
  });

  it('removeStateFile unlinks existing file', () => {
    const state = { testRunId: 'x', quarantineList: [] };
    const path = writeStateFile(state, workDir);
    removeStateFile(path);
    expect(existsSync(path)).toBe(false);
  });
});
