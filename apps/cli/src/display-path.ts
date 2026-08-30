import { homedir } from "node:os";

/** True when the CLI was started with `--verbose`. */
export function isCliVerbose(argv = process.argv.slice(2)): boolean {
  return argv.includes("--verbose");
}

/**
 * Paths shown in CLI output. Default masks home + org/profile ids so shared
 * terminals / stream recordings do not leak identifiers. Pass `verbose`
 * (CLI `--verbose`) for the absolute path.
 */
export function formatCliDisplayPath(
  absolutePath: string,
  verbose = false
): string {
  if (verbose) {
    return absolutePath;
  }

  let out = absolutePath;
  const home = homedir();

  if (home && home !== "/" && (out === home || out.startsWith(`${home}/`))) {
    out = `~${out.slice(home.length)}`;
  } else {
    out = out
      .replace(/\/(?:Users|home)\/[^/]+/g, "~")
      .replace(/[A-Za-z]:\\Users\\[^\\]+/g, "~");
  }

  return out
    .replace(/\/orgs\/[^/]+/g, "/orgs/<org>")
    .replace(/\/profiles\/[^/]+/g, "/profiles/<profile>");
}
