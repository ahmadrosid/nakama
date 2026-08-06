function truncateDisplay(value: string, maxLength: number): string {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function basename(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function readString(input: Record<string, unknown> | undefined, key: string): string | null {
  const value = input?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Short status line for sub-agent child tool activity shown in the parent chat UI. */
export function formatToolActivityLabel(
  tool: string | undefined,
  input?: Record<string, unknown>,
): string {
  if (tool === "read_file") {
    const path = readString(input, "path");

    if (path) {
      return `Reading ${basename(path)}`;
    }
  }

  if (tool === "search_files") {
    const query = readString(input, "query");
    const path = readString(input, "path");

    if (query && path) {
      return `Searching ${basename(path)} · ${truncateDisplay(query, 48)}`;
    }

    if (query) {
      return `Searching · ${truncateDisplay(query, 56)}`;
    }
  }

  if (tool === "knowledge_base_search") {
    const query = readString(input, "query");

    if (query) {
      return `Searching docs · ${truncateDisplay(query, 56)}`;
    }
  }

  if (tool === "web_fetch") {
    const url = readString(input, "url");

    if (url) {
      try {
        const hostname = new URL(url).hostname.replace(/^www\./, "");
        return `Fetching ${truncateDisplay(hostname, 48)}`;
      } catch {
        return `Fetching ${truncateDisplay(url, 56)}`;
      }
    }
  }

  if (tool === "web_search") {
    const query = readString(input, "query");

    if (query) {
      return `Searching web · ${truncateDisplay(query, 56)}`;
    }
  }

  if (tool === "bash") {
    const command = readString(input, "command");

    if (command) {
      return `Running ${truncateDisplay(command.split("\n")[0] ?? command, 64)}`;
    }
  }

  if (tool === "write_file" || tool === "write_docx") {
    const path = readString(input, "path");

    if (path) {
      return `Writing ${basename(path)}`;
    }
  }

  if (tool === "edit_file") {
    const path = readString(input, "path");

    if (path) {
      return `Editing ${basename(path)}`;
    }
  }

  if (tool === "delete_file") {
    const path = readString(input, "path");

    if (path) {
      return `Deleting ${basename(path)}`;
    }
  }

  const query = readString(input, "query");
  if (query) {
    return truncateDisplay(query, 72);
  }

  const path = readString(input, "path");
  if (path) {
    return basename(path);
  }

  const displayTool = tool?.replace(/^[^_]+__/, "") ?? "tool";
  return `Using ${displayTool}`;
}
