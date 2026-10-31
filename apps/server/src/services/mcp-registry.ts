import { NakamaApiError } from "@nakama/core";
import type { McpRegistrySearchResponse } from "@nakama/core/contract";
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
      `${MCP_REGISTRY_SEARCH_URL}?${new URLSearchParams({ limit: "20", search: q })}`,
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
      servers: z.array(
        z.object({
          server: z.unknown(),
        })
      ),
    })
    .safeParse(body);

  if (!items.success) {
    return { servers: [] };
  }

  return {
    servers: items.data.servers.flatMap((item) => {
      const parsed = registryServerSchema.safeParse(item.server);

      if (!parsed.success) {
        return [];
      }

      const { description, name, remotes } = parsed.data;

      // First-cut: remote servers only; package-only entries (local stdio installs) left out.
      if (!remotes || remotes.length === 0) {
        return [];
      }

      return [
        {
          description,
          name,
          remotes,
          transport: remotes[0].type,
        },
      ];
    }),
  };
}
