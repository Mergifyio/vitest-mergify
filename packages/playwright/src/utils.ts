import { createRequire } from 'node:module';

export const LOG_PREFIX = '[@mergifyio/playwright]';
export const DEFAULT_API_URL = 'https://api.mergify.com';

export function getPlaywrightVersion(): string {
  try {
    const req = createRequire(import.meta.url);
    return (req('@playwright/test/package.json') as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

/** Emit a single line to stdout. Thin wrapper so noConsole is suppressed once. */
export function writeLine(msg = ''): void {
  // biome-ignore lint/suspicious/noConsole: plugin surface
  // eslint-disable-next-line no-console
  console.log(msg);
}

/** Prefixed log helper for plugin-level messages. */
export function log(msg: string): void {
  writeLine(`${LOG_PREFIX} ${msg}`);
}
