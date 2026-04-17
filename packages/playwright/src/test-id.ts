import { basename, relative, sep } from 'node:path';

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

/** Convert an absolute file path to a POSIX-style path relative to rootDir. */
export function toRelativePath(filePath: string, rootDir: string): string {
  return toPosix(relative(rootDir, filePath));
}

export interface BuildCanonicalIdArgs {
  /** Absolute path to the spec file (testInfo.file / TestCase.location.file). */
  filePath: string;
  /** Playwright config root (config.rootDir), used to make the file path relative. */
  rootDir: string;
  /**
   * Playwright's titlePath:
   *   [rootSuiteTitle (''), projectName, fileBasename, ...describes, testTitle]
   */
  titlePath: readonly string[];
}

/**
 * Canonical test identifier used for quarantine matching and span names:
 *   "<relative-file-path> > <describe chain> > <test title>"
 *
 * Project name is excluded so the same logical test resolves to the same id
 * regardless of which Playwright project (chromium/firefox/...) runs it.
 */
export function buildCanonicalId(args: BuildCanonicalIdArgs): string {
  const rel = toPosix(relative(args.rootDir, args.filePath));
  const base = basename(args.filePath);
  const fileIdx = args.titlePath.indexOf(base);
  const afterFile = fileIdx >= 0 ? args.titlePath.slice(fileIdx + 1) : args.titlePath.slice(-1);
  return [rel, ...afterFile].join(' > ');
}

/** Extract the namespace (describe chain) separately — useful for span attributes. */
export function extractNamespace(args: BuildCanonicalIdArgs): string {
  const base = basename(args.filePath);
  const fileIdx = args.titlePath.indexOf(base);
  if (fileIdx < 0) return '';
  // Strip the file entry and the final test title, leaving the describes.
  const afterFile = args.titlePath.slice(fileIdx + 1);
  if (afterFile.length <= 1) return '';
  return afterFile.slice(0, -1).join(' > ');
}
