import { describe, expect, it } from 'vitest';
import { buildCanonicalId, extractNamespace, toRelativePath } from '../src/test-id.js';

describe('test-id', () => {
  describe('buildCanonicalId', () => {
    it('builds id from relative file + describes + title, stripping project', () => {
      const id = buildCanonicalId({
        filePath: '/repo/tests/login.spec.ts',
        rootDir: '/repo',
        titlePath: ['', 'chromium', 'login.spec.ts', 'Auth', 'logs in with valid creds'],
      });
      expect(id).toBe('tests/login.spec.ts > Auth > logs in with valid creds');
    });

    it('handles no describes', () => {
      const id = buildCanonicalId({
        filePath: '/repo/smoke.spec.ts',
        rootDir: '/repo',
        titlePath: ['', 'chromium', 'smoke.spec.ts', 'works'],
      });
      expect(id).toBe('smoke.spec.ts > works');
    });

    it('handles nested describes', () => {
      const id = buildCanonicalId({
        filePath: '/repo/tests/a.spec.ts',
        rootDir: '/repo',
        titlePath: ['', 'chromium', 'a.spec.ts', 'Outer', 'Inner', 'case'],
      });
      expect(id).toBe('tests/a.spec.ts > Outer > Inner > case');
    });

    it('is project-independent', () => {
      const chrome = buildCanonicalId({
        filePath: '/repo/t.spec.ts',
        rootDir: '/repo',
        titlePath: ['', 'chromium', 't.spec.ts', 'x'],
      });
      const ff = buildCanonicalId({
        filePath: '/repo/t.spec.ts',
        rootDir: '/repo',
        titlePath: ['', 'firefox', 't.spec.ts', 'x'],
      });
      expect(chrome).toBe(ff);
    });

    it('falls back to last titlePath entry when file basename not found', () => {
      const id = buildCanonicalId({
        filePath: '/repo/weird.ts',
        rootDir: '/repo',
        titlePath: ['', 'chromium', 'only title'],
      });
      expect(id).toBe('weird.ts > only title');
    });
  });

  describe('extractNamespace', () => {
    it('returns describes joined with " > "', () => {
      expect(
        extractNamespace({
          filePath: '/repo/t.spec.ts',
          rootDir: '/repo',
          titlePath: ['', 'chromium', 't.spec.ts', 'Outer', 'Inner', 'x'],
        })
      ).toBe('Outer > Inner');
    });

    it('returns empty string when there are no describes', () => {
      expect(
        extractNamespace({
          filePath: '/repo/t.spec.ts',
          rootDir: '/repo',
          titlePath: ['', 'chromium', 't.spec.ts', 'x'],
        })
      ).toBe('');
    });
  });

  describe('toRelativePath', () => {
    it('returns POSIX path relative to rootDir', () => {
      expect(toRelativePath('/repo/tests/a.spec.ts', '/repo')).toBe('tests/a.spec.ts');
    });
  });
});
