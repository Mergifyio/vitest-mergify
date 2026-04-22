import { describe, expect, it } from 'vitest';
import { buildQuarantineKey } from '../src/quarantine-key.js';
import { extractNamespace } from '../src/utils.js';

describe('buildQuarantineKey', () => {
  it('joins filepath, describes, and title with " > "', () => {
    expect(
      buildQuarantineKey(
        'tests/auth.spec.ts',
        ['chromium', 'tests/auth.spec.ts', 'Login', 'submits form'],
        'submits form'
      )
    ).toBe('tests/auth.spec.ts > Login > submits form');
  });

  it('omits the describe chain when empty', () => {
    expect(
      buildQuarantineKey(
        'tests/auth.spec.ts',
        ['chromium', 'tests/auth.spec.ts', 'submits form'],
        'submits form'
      )
    ).toBe('tests/auth.spec.ts > submits form');
  });

  it('drops empty segments', () => {
    expect(buildQuarantineKey('', ['', '', 'Outer', 'my test'], 'my test')).toBe('Outer > my test');
  });

  it('agrees with extractNamespace + " > " + title (parity guard)', () => {
    const filepath = 'tests/foo.spec.ts';
    const titlePath = ['chromium', 'tests/foo.spec.ts', 'Outer', 'Inner', 'case name'];
    const title = 'case name';
    expect(buildQuarantineKey(filepath, titlePath, title)).toBe(
      `${extractNamespace(filepath, titlePath)} > ${title}`
    );
  });

  it('matches the span-name formula when namespace is empty (no filepath, no describes)', () => {
    const filepath = '';
    const titlePath = ['', '', 'solo'];
    const title = 'solo';
    const namespace = extractNamespace(filepath, titlePath);
    const expectedSpanName = namespace.length > 0 ? `${namespace} > ${title}` : title;
    expect(buildQuarantineKey(filepath, titlePath, title)).toBe(expectedSpanName);
  });

  it('dedupes the file suite from titlePath (Playwright runtime format)', () => {
    // At runtime Playwright exposes the test file as a Suite, so titlePath is
    //   ['', 'node', 'sample.spec.ts', 'quarantined-fails']
    // Without the dedup step the key would be
    //   "tests/sample.spec.ts > sample.spec.ts > quarantined-fails"
    expect(
      buildQuarantineKey(
        'tests/sample.spec.ts',
        ['', 'node', 'sample.spec.ts', 'quarantined-fails'],
        'quarantined-fails'
      )
    ).toBe('tests/sample.spec.ts > quarantined-fails');
  });

  it('dedupes when titlePath contains the full filepath rather than the basename', () => {
    expect(
      buildQuarantineKey(
        'tests/sample.spec.ts',
        ['', 'node', 'tests/sample.spec.ts', 'describe', 'case'],
        'case'
      )
    ).toBe('tests/sample.spec.ts > describe > case');
  });
});
