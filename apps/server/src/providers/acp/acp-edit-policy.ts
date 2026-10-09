import { realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import type * as acp from "@agentclientprotocol/sdk";

/**
 * Approves an agent's file edit only when every file it touches is inside the
 * profile folder. Commands are never approved here: a shell command's paths
 * cannot be checked, so they stay denied.
 */
export function isEditInsideFolder(
  folder: string,
  toolCall: acp.ToolCallUpdate
): boolean {
  if (toolCall.kind !== "edit") {
    return false;
  }

  const locations = toolCall.locations ?? [];

  if (locations.length === 0) {
    return false;
  }

  const root = realpath(folder);

  return locations.every(({ path }) => {
    if (!isAbsolute(path)) {
      return false;
    }

    const target = realpath(resolve(path));

    return target === root || target.startsWith(root + sep);
  });
}

/**
 * Resolves symlinks for the nearest existing ancestor, so a new file inside the
 * folder is checked against its real location.
 */
function realpath(path: string): string {
  let current = resolve(path);
  const rest: string[] = [];

  while (true) {
    try {
      const resolved = realpathSync(current);

      return rest.length > 0 ? resolve(resolved, ...rest.reverse()) : resolved;
    } catch {
      const parent = dirname(current);

      if (parent === current) {
        return resolve(path);
      }

      rest.push(current.slice(parent.length + 1));
      current = parent;
    }
  }
}
