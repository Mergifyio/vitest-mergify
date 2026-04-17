import { createRequire } from 'node:module';
import {
  detectResources,
  envToBool,
  fetchQuarantineList,
  generateTestRunId,
  getRepositoryNameFromUrl,
  git,
  isInCI,
} from '@mergifyio/ci-core';
import type { FullConfig } from '@playwright/test/reporter';
import * as playwrightResource from './resources/playwright.js';
import { writeStateFile } from './state-file.js';

const DEFAULT_API_URL = 'https://api.mergify.com';
const USER_GLOBAL_SETUP_ENV = '_MERGIFY_PLAYWRIGHT_USER_GLOBAL_SETUP';

function getRepoName(): string | undefined {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  if (process.env.GIT_URL) {
    return getRepositoryNameFromUrl(process.env.GIT_URL) ?? undefined;
  }
  const remoteUrl = git('config', '--get', 'remote.origin.url');
  if (remoteUrl) return getRepositoryNameFromUrl(remoteUrl) ?? undefined;
  return undefined;
}

function getPlaywrightVersion(): string {
  try {
    const req = createRequire(import.meta.url);
    return (req('@playwright/test/package.json') as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

function log(msg: string): void {
  // biome-ignore lint/suspicious/noConsole: plugin surface
  // eslint-disable-next-line no-console
  console.log(`[@mergifyio/playwright] ${msg}`);
}

async function runUserGlobalSetup(config: FullConfig): Promise<void> {
  const userPath = process.env[USER_GLOBAL_SETUP_ENV];
  if (!userPath) return;
  const mod = (await import(userPath)) as { default?: unknown };
  const fn = (mod.default ?? mod) as unknown;
  if (typeof fn === 'function') {
    await (fn as (c: FullConfig) => unknown | Promise<unknown>)(config);
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const token = process.env.MERGIFY_TOKEN;
  const apiUrl = process.env.MERGIFY_API_URL ?? DEFAULT_API_URL;
  const repoName = getRepoName();

  const enabled = isInCI() || envToBool(process.env.PLAYWRIGHT_MERGIFY_ENABLE, false);
  if (!enabled || !token || !repoName) {
    await runUserGlobalSetup(config);
    return;
  }

  const testRunId = generateTestRunId();
  const resource = detectResources(playwrightResource.detect(getPlaywrightVersion()), testRunId);
  const attrs = resource.attributes;
  const branch = (attrs['vcs.ref.base.name'] ?? attrs['vcs.ref.head.name']) as string | undefined;

  let quarantineList: string[] = [];
  if (branch) {
    const list = await fetchQuarantineList({ apiUrl, token, repoName, branch }, log);
    quarantineList = [...list];
  }

  writeStateFile({ testRunId, quarantineList });

  await runUserGlobalSetup(config);
}

export { USER_GLOBAL_SETUP_ENV };
