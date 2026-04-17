import { test as base } from '@playwright/test';
import type { TestInfo } from '@playwright/test';
import { type MergifyPlaywrightState, loadState } from './state-file.js';
import { buildCanonicalId } from './test-id.js';

/** Annotation types written by our fixture; the reporter reads these back. */
export const QUARANTINED_ANNOTATION = 'mergify:quarantined';
export const QUARANTINED_ABSORBED_ANNOTATION = 'mergify:quarantined:absorbed';

/**
 * State is loaded once per worker process. Workers are short-lived and the
 * file is written before any worker spawns, so this is safe to cache.
 */
let cachedState: MergifyPlaywrightState | null | undefined;
function getState(): MergifyPlaywrightState | null {
  if (cachedState === undefined) {
    cachedState = loadState();
  }
  return cachedState;
}

/** Reset cache — for tests only. */
export function _resetStateCache(): void {
  cachedState = undefined;
}

function testIdFromTestInfo(testInfo: TestInfo): string {
  return buildCanonicalId({
    filePath: testInfo.file,
    rootDir: testInfo.config.rootDir,
    titlePath: testInfo.titlePath,
  });
}

interface MergifyFixtures {
  _mergifyQuarantine: void;
}

export const mergifyFixture: Parameters<typeof base.extend<MergifyFixtures>>[0] = {
  _mergifyQuarantine: [
    // biome-ignore lint/correctness/noEmptyPattern: empty fixture dependency set is intentional
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      const state = getState();
      if (!state) {
        await use();
        return;
      }

      const id = testIdFromTestInfo(testInfo);
      const quarantined = state.quarantineList.includes(id);

      if (quarantined) {
        testInfo.annotations.push({ type: QUARANTINED_ANNOTATION, description: id });
      }

      await use();
      // Playwright catches test-body errors internally and records them on
      // testInfo.errors — they do NOT propagate through `use()`. To mark a
      // quarantined failure as "expected" (so Playwright reports the run as
      // passed), we flip expectedStatus to 'failed' only when the test
      // actually failed. If it passed, we leave expectedStatus alone so
      // healthy quarantined tests still report as passing.
      if (quarantined && testInfo.errors.length > 0) {
        for (const e of testInfo.errors) {
          testInfo.annotations.push({
            type: QUARANTINED_ABSORBED_ANNOTATION,
            description: JSON.stringify({
              name: 'Error',
              message: e.message ?? '',
              stack: e.stack ?? '',
            }),
          });
        }
        testInfo.expectedStatus = 'failed';
      }
    },
    { auto: true, scope: 'test' },
  ],
};

export const test = base.extend<MergifyFixtures>(mergifyFixture);
