import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Minimal stand-in for Mergify's CI Insights API. Started as a side effect of
 * importing this module from the Playwright config so the server is already
 * listening by the time globalSetup (ours + the user's) runs.
 *
 * Fixed test contract:
 * - GET  /v1/ci/:owner/repositories/:repo/quarantines → one quarantined test
 * - POST /v1/ci/:owner/repositories/:repo/traces      → 200 (OTLP sink)
 */

// Matches the canonical id the plugin computes for failing.spec.ts. The id is
// `<rel-to-rootDir> > <describes> > <title>`, and Playwright's rootDir resolves
// to `testDir` — so the path component is just the basename here.
export const QUARANTINED_TEST_ID = 'failing.spec.ts > quarantined > fails but is absorbed';

const quarantineResponse = {
  quarantined_tests: [{ test_name: QUARANTINED_TEST_ID }],
};

const server = createServer((req, res) => {
  if (req.url?.includes('/quarantines')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(quarantineResponse));
    return;
  }
  if (req.url?.includes('/traces')) {
    // Drain the body, then ack — we don't need to decode the OTLP proto here.
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200);
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

// Bind to IPv4 loopback so subprocess fetches to 127.0.0.1 always reach us.
server.listen(0, '127.0.0.1');

// Block module load until the server is listening, so downstream code can
// trust MERGIFY_API_URL immediately.
await new Promise<void>((resolve) => {
  if (server.listening) {
    resolve();
  } else {
    server.once('listening', () => resolve());
  }
});

const { port } = server.address() as AddressInfo;

// Wire Mergify plugin env vars before Playwright sees the config's globalSetup.
process.env.MERGIFY_API_URL = `http://127.0.0.1:${port}`;
process.env.MERGIFY_TOKEN ??= 'test-token';
process.env.CI ??= 'true';
process.env.GITHUB_ACTIONS ??= 'true';
process.env.GITHUB_REPOSITORY ??= 'test-owner/test-repo';
process.env.GITHUB_REF_NAME ??= 'main';

// Clean up when Playwright exits. The server otherwise keeps the process alive.
const shutdown = () => server.close();
process.once('exit', shutdown);
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
