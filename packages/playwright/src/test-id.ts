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
 * Playwright's documented titlePath layout is:
 *   [rootSuiteTitle (''), projectName, fileBasename, ...describes, testTitle]
 * We locate the file entry by basename and take everything after it. If the
 * basename isn't found — a shape we don't expect but guard against so the id
 * stays stable — we fall back to slice(2), which drops only the empty root
 * and project name. That preserves describes + title for quarantine matching
 * instead of collapsing to the title alone.
 */
function afterFileEntry(args: BuildCanonicalIdArgs): readonly string[] {
  const base = basename(args.filePath);
  const fileIdx = args.titlePath.indexOf(base);
  if (fileIdx >= 0) return args.titlePath.slice(fileIdx + 1);
  return args.titlePath.slice(2);
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
  return [rel, ...afterFileEntry(args)].join(' > ');
}

/** Extract the namespace (describe chain) separately — useful for span attributes. */
export function extractNamespace(args: BuildCanonicalIdArgs): string {
  const afterFile = afterFileEntry(args);
  if (afterFile.length <= 1) return '';
  return afterFile.slice(0, -1).join(' > ');
}
