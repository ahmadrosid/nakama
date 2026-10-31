import { NakamaApiError } from "@nakama/core";
import type {
  McpRegistrySearchResponse,
  McpRegistryServer,
} from "@nakama/core/contract";
import { z } from "zod";

const MCP_REGISTRY_SEARCH_URL =
  "https://registry.modelcontextprotocol.io/v0/servers";

const remoteHeaderSchema = z.object({
  description: z.string().optional(),
  isRequired: z.boolean().optional(),
  isSecret: z.boolean().optional(),
  name: z.string(),
  value: z.string().optional(),
});

const remoteSchema = z.object({
  headers: z.array(remoteHeaderSchema).optional(),
  type: z.string(),
  url: z.string(),
});

const registryServerSchema = z.object({
  description: z.string().optional(),
  name: z.string(),
  remotes: z.array(remoteSchema).optional(),
});

const registryItemSchema = z.object({
  _meta: z
    .object({
      "io.modelcontextprotocol.registry/official": z
        .object({
          isLatest: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  server: registryServerSchema,
});

export async function searchMcpRegistry(
  query: string
): Promise<McpRegistrySearchResponse> {
  const q = query.trim();

  if (q.length < 2) {
    return { servers: [] };
  }

  let body: unknown;

  try {
    const response = await fetch(
      `${MCP_REGISTRY_SEARCH_URL}?${new URLSearchParams({
        limit: "20",
        search: q,
        version: "latest",
      })}`,
      { signal: AbortSignal.timeout(10_000) }
    );

    if (!response.ok) {
      throw new Error(
        `registry.modelcontextprotocol.io answered ${response.status}`
      );
    }

    body = await response.json();
  } catch {
    throw new NakamaApiError(
      "MCP registry is unavailable. Enter configuration manually instead.",
      502
    );
  }

  const items = z
    .object({
      servers: z.array(registryItemSchema),
    })
    .safeParse(body);

  if (!items.success) {
    return { servers: [] };
  }

  const serversByName = new Map<string, McpRegistryServer>();

  for (const item of items.data.servers) {
    const isLatest =
      item._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest;

    if (isLatest === false) {
      continue;
    }

    const { description, name, remotes } = item.server;

    // Remote servers only: filter for HTTP transports (streamable-http), excluding SSE or package/stdio.
    const validRemotes = (remotes ?? []).filter(
      (remote) => remote.type === "streamable-http" || remote.type === "http"
    );

    if (validRemotes.length === 0) {
      continue;
    }

    if (!serversByName.has(name)) {
      serversByName.set(name, {
        description,
        name,
        remotes: validRemotes,
        transport: validRemotes[0].type,
      });
    }
  }

  return {
    servers: Array.from(serversByName.values()),
  };
}
