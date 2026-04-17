// Start the mock Mergify API before the config is evaluated. `await` at the
// top level works because Playwright loads config files as ESM.
import './mock-server.js';

import { defineConfig } from '@playwright/test';
import { withMergify } from '../../src/config.js';

export default withMergify(
  defineConfig({
    testDir: './tests',
    workers: 1,
    retries: 0,
    reporter: [['list']],
  })
);
