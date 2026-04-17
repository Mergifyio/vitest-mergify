import type { PlaywrightTestConfig, ReporterDescription } from '@playwright/test';

export const REPORTER_PATH = '@mergifyio/playwright/reporter';
export const SETUP_PATH = '@mergifyio/playwright/setup';
export const TEARDOWN_PATH = '@mergifyio/playwright/teardown';

type HookPath = string | string[] | undefined;
type ReporterField = PlaywrightTestConfig['reporter'];

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function normalizeReporter(r: ReporterField): ReporterDescription[] {
  if (r === undefined) return [];
  if (typeof r === 'string') return [[r]];
  return r;
}

export function prependReporter(existing: ReporterField, name: string): ReporterDescription[] {
  const arr = normalizeReporter(existing);
  if (arr.some((r) => r[0] === name)) return arr;
  return [[name], ...arr];
}

export function prependHookPath(existing: HookPath, ours: string): string[] {
  const arr = toArray(existing);
  if (arr.includes(ours)) return arr;
  return [ours, ...arr];
}

/**
 * Wrap a Playwright config to wire in Mergify's reporter, globalSetup, and
 * globalTeardown. Idempotent — calling it twice is a no-op.
 *
 * ```ts
 * import { defineConfig } from '@playwright/test';
 * import { withMergify } from '@mergifyio/playwright/config';
 *
 * export default withMergify(defineConfig({
 *   // your config
 * }));
 * ```
 */
export function withMergify<T extends PlaywrightTestConfig>(config: T): T {
  return {
    ...config,
    reporter: prependReporter(config.reporter, REPORTER_PATH),
    globalSetup: prependHookPath(config.globalSetup, SETUP_PATH),
    globalTeardown: prependHookPath(config.globalTeardown, TEARDOWN_PATH),
  };
}
