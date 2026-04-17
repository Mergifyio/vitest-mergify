import {
  detectResources,
  envToBool,
  fetchQuarantineList,
  generateTestRunId,
  getRepoName,
  isInCI,
} from '@mergifyio/ci-core';
import type { FullConfig } from '@playwright/test/reporter';
import * as playwrightResource from './resources/playwright.js';
import { writeStateFile } from './state-file.js';
import { DEFAULT_API_URL, getPlaywrightVersion, log } from './utils.js';

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
