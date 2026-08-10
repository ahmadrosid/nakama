import type {
  McpHttpConfig,
  McpStdioConfig,
  McpTransport,
} from "@nakama/core/contract";

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
    return { error: "Invalid JSON.", ok: false };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { error: "Expected a JSON object.", ok: false };
  }

  const record = parsed as Record<string, unknown>;
  const entries = readServerEntries(record);

  if (!entries) {
    return { error: "No MCP server config found in JSON.", ok: false };
  }

  if (entries.length === 0) {
    return { error: "mcpServers is empty.", ok: false };
  }

  const [name, serverConfig] = entries[0]!;

  if (typeof serverConfig !== "object" || serverConfig === null) {
    return { error: "Invalid server config.", ok: false };
  }

  const config = serverConfig as Record<string, unknown>;
  const serverName = name.trim() || "mcp-server";

  if (typeof config.url === "string" && config.url.trim()) {
    return {
      importedCount: entries.length,
      ok: true,
      server: {
        config: {
          headers: readStringRecord(config.headers),
          url: config.url.trim(),
        },
        name: serverName,
        transport: "http",
      },
    };
  }

  if (typeof config.command === "string" && config.command.trim()) {
    return {
      importedCount: entries.length,
      ok: true,
      server: {
        config: {
          args: readStringArray(config.args),
          command: config.command.trim(),
          env: readStringRecord(config.env),
        },
        name: serverName,
        transport: "stdio",
      },
    };
  }

  return { error: "Server config needs command or url.", ok: false };
}

function readServerEntries(
  record: Record<string, unknown>
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
    return;
  }

  const items = value.flatMap((entry) => {
    if (typeof entry !== "string") {
      return [];
    }

    const trimmed = entry.trim();
    return trimmed ? [trimmed] : [];
  });

  return items.length > 0 ? items : undefined;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null) {
    return;
  }

  const record: Record<string, string> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      record[key] = entry;
    }
  }

  return Object.keys(record).length > 0 ? record : undefined;
}
