import { z } from "zod";

const ActivityInputSchema = z.object({
  command: z.string().optional(),
  path: z.string().optional(),
  query: z.string().optional(),
  url: z.string().optional(),
});

type ActivityInput = z.infer<typeof ActivityInputSchema>;

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

function readString(
  input: ActivityInput,
  key: keyof ActivityInput
): string | null {
  const value = input[key]?.trim();

  return value || null;
}

/** Short status line for sub-agent child tool activity shown in the parent chat UI. */
export function formatToolActivityLabel(
  tool: string | undefined,
  input?: ActivityInput
): string {
  const parsedInput = ActivityInputSchema.safeParse(input);
  const details = parsedInput.success ? parsedInput.data : {};

  if (tool === "read_file") {
    const path = readString(details, "path");

    if (path) {
      return `Reading ${basename(path)}`;
    }
  }

  if (tool === "search_files") {
    const query = readString(details, "query");
    const path = readString(details, "path");

    if (query && path) {
      return `Searching ${basename(path)} · ${truncateDisplay(query, 48)}`;
    }

    if (query) {
      return `Searching · ${truncateDisplay(query, 56)}`;
    }
  }

  if (tool === "knowledge_base_search") {
    const query = readString(details, "query");

    if (query) {
      return `Searching docs · ${truncateDisplay(query, 56)}`;
    }
  }

  if (tool === "web_fetch") {
    const url = readString(details, "url");

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
    const query = readString(details, "query");

    if (query) {
      return `Searching web · ${truncateDisplay(query, 56)}`;
    }
  }

  if (tool === "bash") {
    const command = readString(details, "command");

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
