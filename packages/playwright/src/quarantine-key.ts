import { stripFileSuite } from './utils.js';

/**
 * Build the quarantine-matching key for a Playwright test: the same string the
 * Mergify backend stores as `test_name` (derived from the emitted span name).
 *
 * Must match the span name produced by `emitTestCaseSpan` in @mergifyio/ci-core:
 *   namespace > function  (when namespace is non-empty)
 *   function              (when namespace is empty)
 * where `namespace` is `extractNamespace(filepath, titlePath)`. The filter step
 * below drops the empty prefix in the second case so the equality holds in both.
 */
export function buildQuarantineKey(
  filepath: string,
  titlePath: readonly string[],
  title: string
): string {
  const describes = stripFileSuite(titlePath.slice(2, -1), filepath);
  const parts = [filepath, ...describes, title].filter((p) => p.length > 0);
  return parts.join(' > ');
}
