import type { PlaywrightTestConfig } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import {
  REPORTER_PATH,
  SETUP_PATH,
  TEARDOWN_PATH,
  prependHookPath,
  prependReporter,
  withMergify,
} from '../src/config.js';

describe('prependReporter', () => {
  it('adds our reporter when reporter is undefined', () => {
    expect(prependReporter(undefined, REPORTER_PATH)).toEqual([[REPORTER_PATH]]);
  });

  it('converts string reporter to array and prepends', () => {
    expect(prependReporter('list', REPORTER_PATH)).toEqual([[REPORTER_PATH], ['list']]);
  });

  it('keeps user reporters and adds ours at the front', () => {
    expect(prependReporter([['list'], ['json', { outputFile: 'x.json' }]], REPORTER_PATH)).toEqual([
      [REPORTER_PATH],
      ['list'],
      ['json', { outputFile: 'x.json' }],
    ]);
  });

  it('is idempotent — does not add our reporter twice', () => {
    const first = prependReporter(undefined, REPORTER_PATH);
    const second = prependReporter(first, REPORTER_PATH);
    expect(second).toEqual([[REPORTER_PATH]]);
  });
});

describe('prependHookPath', () => {
  it('adds our path when undefined', () => {
    expect(prependHookPath(undefined, SETUP_PATH)).toEqual([SETUP_PATH]);
  });

  it('wraps string and prepends', () => {
    expect(prependHookPath('./custom-setup.ts', SETUP_PATH)).toEqual([
      SETUP_PATH,
      './custom-setup.ts',
    ]);
  });

  it('prepends into array', () => {
    expect(prependHookPath(['a', 'b'], SETUP_PATH)).toEqual([SETUP_PATH, 'a', 'b']);
  });

  it('is idempotent', () => {
    expect(prependHookPath([SETUP_PATH, 'a'], SETUP_PATH)).toEqual([SETUP_PATH, 'a']);
  });
});

describe('withMergify', () => {
  it('wires all three: reporter, globalSetup, globalTeardown', () => {
    const wrapped = withMergify<PlaywrightTestConfig>({
      testDir: './tests',
      retries: 2,
    });
    expect(wrapped.testDir).toBe('./tests');
    expect(wrapped.retries).toBe(2);
    expect(wrapped.reporter).toEqual([[REPORTER_PATH]]);
    expect(wrapped.globalSetup).toEqual([SETUP_PATH]);
    expect(wrapped.globalTeardown).toEqual([TEARDOWN_PATH]);
  });

  it('preserves user reporter and hooks', () => {
    const wrapped = withMergify<PlaywrightTestConfig>({
      reporter: 'list',
      globalSetup: './user-setup.ts',
      globalTeardown: './user-teardown.ts',
    });
    expect(wrapped.reporter).toEqual([[REPORTER_PATH], ['list']]);
    expect(wrapped.globalSetup).toEqual([SETUP_PATH, './user-setup.ts']);
    expect(wrapped.globalTeardown).toEqual([TEARDOWN_PATH, './user-teardown.ts']);
  });

  it('is idempotent — wrapping twice does not duplicate', () => {
    const once = withMergify<PlaywrightTestConfig>({ testDir: './t' });
    const twice = withMergify(once);
    expect(twice.reporter).toEqual([[REPORTER_PATH]]);
    expect(twice.globalSetup).toEqual([SETUP_PATH]);
    expect(twice.globalTeardown).toEqual([TEARDOWN_PATH]);
  });
});
