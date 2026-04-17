import type { FullConfig } from '@playwright/test/reporter';
import { removeStateFile } from './state-file.js';

const USER_GLOBAL_TEARDOWN_ENV = '_MERGIFY_PLAYWRIGHT_USER_GLOBAL_TEARDOWN';

async function runUserGlobalTeardown(config: FullConfig): Promise<void> {
  const userPath = process.env[USER_GLOBAL_TEARDOWN_ENV];
  if (!userPath) return;
  const mod = (await import(userPath)) as { default?: unknown };
  const fn = (mod.default ?? mod) as unknown;
  if (typeof fn === 'function') {
    await (fn as (c: FullConfig) => unknown | Promise<unknown>)(config);
  }
}

export default async function globalTeardown(config: FullConfig): Promise<void> {
  try {
    await runUserGlobalTeardown(config);
  } finally {
    removeStateFile();
  }
}

export { USER_GLOBAL_TEARDOWN_ENV };
