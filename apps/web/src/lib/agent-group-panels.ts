/** Search params of the side panel; one is open at a time. */
export const PANELS = ["files", "live", "memory", "thread"] as const;

/**
 * `current` with only `panel` open. For `files`, a value other than "1" is the
 * path of the file to show.
 */
export function withPanel(
  current: URLSearchParams,
  panel: (typeof PANELS)[number],
  value: string | null
): URLSearchParams {
  const next = new URLSearchParams(current);

  for (const key of PANELS) {
    next.delete(key);
  }

  if (value !== null) {
    next.set(panel, value);
  }

  return next;
}

/** An agent's full path into a group's shared folder, up to `shared/`. */
const SHARED_DIR_PREFIX =
  /(?:[A-Za-z]:)?[^\s`'"(<[]*\/groups\/[\w-]+\/shared\//g;

const SHARED_FILE = /(?<![\w./-])shared\/([^\s`'"()<>[\]]+)/g;

/** Agents' full paths into the shared folder, as `shared/…`. */
export function shortenSharedPaths(content: string): string {
  return content.replace(SHARED_DIR_PREFIX, "shared/");
}

/** Files in the shared folder a message names, relative to the folder. */
export function sharedFileMentions(content: string): string[] {
  const paths = new Set<string>();

  for (const [, path = ""] of shortenSharedPaths(content).matchAll(
    SHARED_FILE
  )) {
    const file = path.replace(/[.,;:!?*_]+$/, "");

    if (file && !file.endsWith("/")) {
      paths.add(file);
    }
  }

  return [...paths];
}
