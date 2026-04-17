import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface MergifyPlaywrightState {
  testRunId: string;
  quarantineList: string[];
}

/**
 * Resolve the state-file path. Deterministic per run via testRunId so main-process
 * and worker processes can find it without env-var plumbing.
 */
export function stateFilePath(testRunId: string, cwd: string = process.cwd()): string {
  return join(cwd, 'node_modules', '.cache', '@mergifyio', 'playwright', `state-${testRunId}.json`);
}

const STATE_FILE_ENV = 'MERGIFY_PLAYWRIGHT_STATE_FILE';

/** Write state to disk and record its path via env so workers locate it deterministically. */
export function writeStateFile(state: MergifyPlaywrightState, cwd: string = process.cwd()): string {
  const path = stateFilePath(state.testRunId, cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state), 'utf-8');
  process.env[STATE_FILE_ENV] = path;
  return path;
}

/** Read state from an explicit path; returns null if the file isn't there. */
export function readStateFile(path: string): MergifyPlaywrightState | null {
  try {
    const data = readFileSync(path, 'utf-8');
    return JSON.parse(data) as MergifyPlaywrightState;
  } catch {
    return null;
  }
}

/**
 * Read the current state using the env-recorded path. Returns null if the plugin
 * didn't activate (no file written) — callers should treat this as "do nothing".
 */
export function loadState(): MergifyPlaywrightState | null {
  const path = process.env[STATE_FILE_ENV];
  if (!path) return null;
  return readStateFile(path);
}

/** Best-effort cleanup — absent file is fine. */
export function removeStateFile(path?: string): void {
  const target = path ?? process.env[STATE_FILE_ENV];
  if (!target) return;
  try {
    rmSync(target, { force: true });
  } catch {
    // ignore
  }
}

export { STATE_FILE_ENV };
