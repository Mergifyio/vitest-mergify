import { describe, expect, it } from 'vitest';
import { applyQuarantine } from '../src/fixture.js';

interface MockInfo {
  title: string;
  titlePath: string[];
  file: string;
  status: 'passed' | 'failed' | 'timedOut' | 'interrupted' | 'skipped';
  expectedStatus: 'passed' | 'failed' | 'skipped';
  annotations: Array<{ type: string; description?: string }>;
}

function mockInfo(overrides: Partial<MockInfo> = {}): MockInfo {
  return {
    title: 'adds numbers',
    titlePath: ['chromium', '/repo/tests/math.spec.ts', 'math', 'adds numbers'],
    file: '/repo/tests/math.spec.ts',
    status: 'passed',
    expectedStatus: 'passed',
    annotations: [],
    ...overrides,
  };
}

describe('applyQuarantine', () => {
  const quarantineSet = new Set(['tests/math.spec.ts > math > adds numbers']);

  it('mutates expectedStatus and pushes annotation when quarantined + failed', () => {
    const info = mockInfo({ status: 'failed' });
    applyQuarantine({ testInfo: info as never, quarantineSet, rootDir: '/repo' });
    expect(info.expectedStatus).toBe('failed');
    expect(info.annotations).toContainEqual({ type: 'mergify:quarantined' });
  });

  it('does not mutate when quarantined but passing (non-strict semantics)', () => {
    const info = mockInfo({ status: 'passed' });
    applyQuarantine({ testInfo: info as never, quarantineSet, rootDir: '/repo' });
    expect(info.expectedStatus).toBe('passed');
    expect(info.annotations).toEqual([]);
  });

  it('does not mutate when failing but not quarantined', () => {
    const info = mockInfo({
      status: 'failed',
      title: 'other',
      titlePath: ['chromium', '/repo/tests/math.spec.ts', 'math', 'other'],
    });
    applyQuarantine({ testInfo: info as never, quarantineSet, rootDir: '/repo' });
    expect(info.expectedStatus).toBe('passed');
    expect(info.annotations).toEqual([]);
  });

  it('is a no-op when the quarantine set is empty', () => {
    const info = mockInfo({ status: 'failed' });
    applyQuarantine({ testInfo: info as never, quarantineSet: new Set(), rootDir: '/repo' });
    expect(info.expectedStatus).toBe('passed');
  });

  it('treats timedOut as a failure for quarantine purposes', () => {
    const info = mockInfo({ status: 'timedOut' });
    applyQuarantine({ testInfo: info as never, quarantineSet, rootDir: '/repo' });
    expect(info.expectedStatus).toBe('failed');
  });
});
