import { describe, expect, it } from 'vitest';
import { extractNamespace, mapStatus, projectNameFromTest, toPosix } from '../src/utils.js';

describe('extractNamespace', () => {
  it('prefixes the describe chain with the filepath', () => {
    expect(
      extractNamespace('tests/foo.spec.ts', [
        'chromium',
        'tests/foo.spec.ts',
        'outer',
        'inner',
        'my test',
      ])
    ).toBe('tests/foo.spec.ts > outer > inner');
  });

  it('returns just the filepath when there is no describe', () => {
    expect(
      extractNamespace('tests/foo.spec.ts', ['chromium', 'tests/foo.spec.ts', 'my test'])
    ).toBe('tests/foo.spec.ts');
  });

  it('handles a single describe', () => {
    expect(
      extractNamespace('tests/foo.spec.ts', ['chromium', 'tests/foo.spec.ts', 'outer', 'my test'])
    ).toBe('tests/foo.spec.ts > outer');
  });

  it('drops empty segments so the result has no leading or trailing separator', () => {
    expect(extractNamespace('', ['', '', 'outer', 'my test'])).toBe('outer');
  });
});

describe('toPosix', () => {
  it('is a no-op on POSIX-style paths', () => {
    expect(toPosix('tests/sample.spec.ts')).toBe('tests/sample.spec.ts');
  });

  it('replaces backslashes with forward slashes (Windows input)', () => {
    expect(toPosix('tests\\sample.spec.ts')).toBe('tests/sample.spec.ts');
  });

  it('handles mixed separators', () => {
    expect(toPosix('packages\\core/src\\types.ts')).toBe('packages/core/src/types.ts');
  });

  it('returns empty string unchanged', () => {
    expect(toPosix('')).toBe('');
  });
});

describe('extractNamespace — Windows-style input', () => {
  it('produces POSIX-separated output when the caller pre-normalizes with toPosix', () => {
    const winPath = toPosix('tests\\sample.spec.ts');
    expect(extractNamespace(winPath, ['', 'chromium', 'sample.spec.ts', 'my test'])).toBe(
      'tests/sample.spec.ts'
    );
  });
});

describe('mapStatus', () => {
  it.each([
    ['passed', 'passed'],
    ['skipped', 'skipped'],
    ['failed', 'failed'],
    ['timedOut', 'failed'],
    ['interrupted', 'failed'],
  ] as const)('maps %s to %s', (input, expected) => {
    expect(mapStatus(input)).toBe(expected);
  });
});

describe('projectNameFromTest', () => {
  it('returns the first entry of titlePath as the project name', () => {
    const fakeTest = {
      titlePath: () => ['firefox', 'tests/x.spec.ts', 'my test'],
    } as unknown as Parameters<typeof projectNameFromTest>[0];
    expect(projectNameFromTest(fakeTest)).toBe('firefox');
  });

  it('returns undefined when titlePath first entry is empty', () => {
    const fakeTest = {
      titlePath: () => ['', 'tests/x.spec.ts', 'my test'],
    } as unknown as Parameters<typeof projectNameFromTest>[0];
    expect(projectNameFromTest(fakeTest)).toBeUndefined();
  });
});
