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

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const token = process.env.MERGIFY_TOKEN;
  const apiUrl = process.env.MERGIFY_API_URL ?? DEFAULT_API_URL;
  const repoName = getRepoName();

  const enabled = isInCI() || envToBool(process.env.PLAYWRIGHT_MERGIFY_ENABLE, false);
  if (!enabled || !token || !repoName) return;

  const testRunId = generateTestRunId();
  const resource = detectResources(playwrightResource.detect(getPlaywrightVersion()), testRunId);
  const attrs = resource.attributes;
  const branch = (attrs['vcs.ref.base.name'] ?? attrs['vcs.ref.head.name']) as string | undefined;

  let quarantineList: string[] = [];
  if (branch) {
    const list = await fetchQuarantineList({ apiUrl, token, repoName, branch }, log);
    quarantineList = [...list];
  }

  try {
    writeStateFile({ testRunId, quarantineList });
  } catch (error) {
    // Must never break the user's test run — a read-only/permission error on
    // node_modules/.cache would otherwise abort globalSetup and kill Playwright.
    const message = error instanceof Error ? error.message : String(error);
    log(`Failed to write state file, continuing without persisted state: ${message}`);
  }
}
