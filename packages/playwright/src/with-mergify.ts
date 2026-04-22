import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlaywrightTestConfig } from '@playwright/test';

function here(): string {
  return typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));
}

// Match the extension of the currently-loaded module file so we resolve the
// sibling entry points (global-setup, global-teardown, reporter) against the
// same format. tsdown emits .mjs and .cjs — not plain .js — so a naive
// `global-setup.js` would fail at load time.
function entryExt(): string {
  const current = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
  if (current.endsWith('.cjs')) return '.cjs';
  if (current.endsWith('.mjs')) return '.mjs';
  // Source/dev mode (e.g. running through tsx): fall back to .js and let the
  // loader resolve the TS file it actually wants.
  return '.js';
}

type ReporterEntry = string | [string, unknown?];

function reporterToArray(r: PlaywrightTestConfig['reporter']): ReporterEntry[] {
  if (r === undefined) return [];
  if (typeof r === 'string') return [[r]];
  if (Array.isArray(r)) {
    // Could be a single tuple ['list', {...}] OR an array of tuples.
    if (r.length > 0 && typeof r[0] === 'string') {
      return [r as unknown as ReporterEntry];
    }
    return r as unknown as ReporterEntry[];
  }
  return [];
}

function pathArray(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? [...value] : [value as string];
}

/**
 * Wrap a Playwright config to inject the Mergify reporter, globalSetup, and
 * globalTeardown. Existing user entries are preserved — Mergify's are appended.
 */
export function withMergify(config: PlaywrightTestConfig): PlaywrightTestConfig {
  const dir = here();
  const ext = entryExt();
  const setupPath = resolve(dir, `global-setup${ext}`);
  const teardownPath = resolve(dir, `global-teardown${ext}`);
  // `reporter` is not a dedicated entry point — it's bundled into the package
  // index. Point Playwright at the index so it picks up MergifyReporter as the
  // default export.
  const reporterPath = resolve(dir, `index${ext}`);

  return {
    ...config,
    reporter: [...reporterToArray(config.reporter), [reporterPath]],
    globalSetup: [...pathArray(config.globalSetup), setupPath],
    globalTeardown: [...pathArray(config.globalTeardown), teardownPath],
  } as unknown as PlaywrightTestConfig;
}
