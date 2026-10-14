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

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
  if (typeof parsed !== "object" || parsed === null) {
    return { error: "Expected a JSON object.", ok: false };
  }

  // SAFETY: The enclosing parser checks the value before this conversion.
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
  const record = parsed as Record<string, unknown>;
  const entries = readServerEntries(record);

  if (!entries) {
    return { error: "No MCP server config found in JSON.", ok: false };
  }

  const first = entries[0];

  if (!first) {
    return { error: "mcpServers is empty.", ok: false };
  }

  const [name, serverConfig] = first;

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
  if (typeof serverConfig !== "object" || serverConfig === null) {
    return { error: "Invalid server config.", ok: false };
  }

  // SAFETY: The enclosing parser checks the value before this conversion.
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
  const config = serverConfig as Record<string, unknown>;
  const serverName = name.trim() || "mcp-server";

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
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

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
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
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
  record: Record<string, unknown>
): Array<[string, unknown]> | null {
  if (
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
    typeof record.mcpServers === "object" &&
    record.mcpServers !== null &&
    !Array.isArray(record.mcpServers)
  ) {
    // SAFETY: The enclosing parser checks the value before this conversion.
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
    return Object.entries(record.mcpServers as Record<string, unknown>);
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
  if (typeof record.command === "string" || typeof record.url === "string") {
    return [["mcp-server", record]];
  }

  return null;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts untrusted provider or tool output and decodes it at this boundary.
function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return;
  }

  const items = value.flatMap((entry) => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
    if (typeof entry !== "string") {
      return [];
    }

    const trimmed = entry.trim();

    return trimmed ? [trimmed] : [];
  });

  return items.length > 0 ? items : undefined;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts untrusted provider or tool output and decodes it at this boundary.
function readStringRecord(value: unknown): Record<string, string> | undefined {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
  if (typeof value !== "object" || value === null) {
    return;
  }

  const record: Record<string, string> = {};

  for (const [key, entry] of Object.entries(value)) {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
    if (typeof entry === "string") {
      record[key] = entry;
    }
  }

  return Object.keys(record).length > 0 ? record : undefined;
}
