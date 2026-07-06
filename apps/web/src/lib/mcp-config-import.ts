import type { McpHttpConfig, McpStdioConfig, McpTransport } from "@nakama/core/contract";

export type ParsedMcpServerImport = {
  name: string;
  transport: McpTransport;
  config: McpHttpConfig | McpStdioConfig;
};

export type ParseMcpConfigResult =
  | { ok: true; server: ParsedMcpServerImport; importedCount: number }
  | { ok: false; error: string };

export function parseMcpConfigJson(text: string): ParseMcpConfigResult | null {
  const trimmed = text.trim();

  if (!trimmed.startsWith("{")) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "Invalid JSON." };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "Expected a JSON object." };
  }

  const record = parsed as Record<string, unknown>;
  const entries = readServerEntries(record);

  if (!entries) {
    return { ok: false, error: "No MCP server config found in JSON." };
  }

  if (entries.length === 0) {
    return { ok: false, error: "mcpServers is empty." };
  }

  const [name, serverConfig] = entries[0]!;

  if (typeof serverConfig !== "object" || serverConfig === null) {
    return { ok: false, error: "Invalid server config." };
  }

  const config = serverConfig as Record<string, unknown>;
  const serverName = name.trim() || "mcp-server";

  if (typeof config.url === "string" && config.url.trim()) {
    return {
      ok: true,
      importedCount: entries.length,
      server: {
        name: serverName,
        transport: "http",
        config: {
          url: config.url.trim(),
          headers: readStringRecord(config.headers),
        },
      },
    };
  }

  if (typeof config.command === "string" && config.command.trim()) {
    return {
      ok: true,
      importedCount: entries.length,
      server: {
        name: serverName,
        transport: "stdio",
        config: {
          command: config.command.trim(),
          args: readStringArray(config.args),
          env: readStringRecord(config.env),
        },
      },
    };
  }

  return { ok: false, error: "Server config needs command or url." };
}

function readServerEntries(
  record: Record<string, unknown>,
): Array<[string, unknown]> | null {
  if (
    typeof record.mcpServers === "object" &&
    record.mcpServers !== null &&
    !Array.isArray(record.mcpServers)
  ) {
    return Object.entries(record.mcpServers as Record<string, unknown>);
  }

  if (typeof record.command === "string" || typeof record.url === "string") {
    return [["mcp-server", record]];
  }

  return null;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record: Record<string, string> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      record[key] = entry;
    }
  }

  return Object.keys(record).length > 0 ? record : undefined;
}
