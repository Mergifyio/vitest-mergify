import type { FullConfig } from '@playwright/test/reporter';
import { removeStateFile } from './state-file.js';

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  removeStateFile();
}
