import { Composio } from "@composio/core";
import type { ComposioCachedToolSummary } from "@nakama/core";
import { z } from "zod";

const CatalogToolkitItemSchema = z.object({
  meta: z
    .object({
      description: z.string().optional().catch(undefined),
      logo: z.string().optional().catch(undefined),
    })
    .catch({})
    .optional(),
  name: z.string().optional().catch(undefined),
  slug: z.string().optional().catch(undefined),
});

const ComposioRecordSchema = z.record(z.string(), z.json());

const LinkResponseSchema = z.union([
  z.string().transform((directUrl) => ({ directUrl })),
  z
    .object({
      authorization_url: z.string().optional().catch(undefined),
      authorizationUrl: z.string().optional().catch(undefined),
      connected_account_id: z.string().optional().catch(undefined),
      connectedAccountId: z.string().optional().catch(undefined),
      connection: z.union([z.string(), z.object({}).passthrough()]).optional(),
      connectionRequest: z
        .union([z.string(), z.object({}).passthrough()])
        .optional(),
      data: z.union([z.string(), z.object({}).passthrough()]).optional(),
      id: z.string().optional().catch(undefined),
      redirect_url: z.string().optional().catch(undefined),
      redirectUrl: z.string().optional().catch(undefined),
      url: z.string().optional().catch(undefined),
    })
    .passthrough()
    .transform((response) => ({ ...response, directUrl: undefined })),
]);

const SessionToolItemSchema = z.object({
  description: z.string().optional().catch(undefined),
  input_parameters: ComposioRecordSchema.optional().catch(undefined),
  inputParameters: ComposioRecordSchema.optional().catch(undefined),
  name: z.string().optional().catch(undefined),
  slug: z.string().optional().catch(undefined),
});

export interface ComposioCatalogToolkit {
  description: string | null;
  logoUrl: string | null;
  name: string;
  slug: string;
}

export interface ComposioLinkResult {
  connectedAccountId?: string;
  redirectUrl: string;
}

export interface ComposioSessionMcpEndpoint {
  headers?: Record<string, string>;
  sessionId: string;
  url: string;
}

export function extractComposioListItems<T>(
  response: { items?: T[] } | T[] | null | undefined
): T[] {
  if (Array.isArray(response)) {
    return response;
  }

  if (response && Array.isArray(response.items)) {
    return response.items;
  }

  return [];
}

export function parseCatalogToolkitItem(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This I/O parser validates untrusted SDK responses with CatalogToolkitItemSchema.
  input: unknown
): ComposioCatalogToolkit | null {
  const item = CatalogToolkitItemSchema.parse(input);
  const slug = item.slug ?? item.name?.toLowerCase() ?? null;

  if (!slug) {
    return null;
  }

  return {
    description: item.meta?.description ?? null,
    logoUrl: item.meta?.logo ?? null,
    name: item.name ?? slug,
    slug: slug.toLowerCase(),
  };
}

export function parseLinkRedirectUrl(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This I/O parser validates untrusted SDK responses with LinkResponseSchema.
  input: unknown
): string | null {
  const response = LinkResponseSchema.parse(input);

  if (response.directUrl !== undefined) {
    return response.directUrl.startsWith("http") ? response.directUrl : null;
  }

  for (const key of [
    "redirectUrl",
    "redirect_url",
    "authorizationUrl",
    "authorization_url",
    "url",
  ] as const) {
    const value = response[key];

    if (value) {
      return value;
    }
  }

  for (const nestedKey of [
    "connectionRequest",
    "data",
    "connection",
  ] as const) {
    const nested = response[nestedKey];

    if (nested) {
      const nestedUrl = parseLinkRedirectUrl(nested);

      if (nestedUrl) {
        return nestedUrl;
      }
    }
  }

  return null;
}

function parseConnectionRequestId(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This I/O parser validates untrusted SDK responses with LinkResponseSchema.
  input: unknown
): string | undefined {
  const response = LinkResponseSchema.parse(input);

  if (response.directUrl !== undefined) {
    return undefined;
  }

  return (
    response.id ?? response.connectedAccountId ?? response.connected_account_id
  );
}

export function unwrapComposioError(error: Error): Error {
  const cause = error.cause;

  if (cause instanceof Error && cause.message.trim()) {
    return new Error(`${error.message}: ${cause.message}`, { cause });
  }

  return error;
}

type ComposioAuthConfigClient = {
  authConfigs: {
    list(query?: { toolkit?: string }): Promise<{
      items: Array<{ id?: string; isComposioManaged?: boolean }>;
    }>;
    create(
      toolkitSlug: string,
      options?: { type?: string }
    ): Promise<{ id?: string }>;
  };
};

type ComposioToolkitPageClient = {
  toolkits: {
    list(query: { cursor?: string; limit: number }): Promise<{
      items: unknown[];
      next_cursor?: string | null;
    }>;
  };
};

const CATALOG_PAGE_SIZE = 1000;

/** A guard against a cursor that never ends, far above today's catalog. */
const MAX_CATALOG_PAGES = 20;

/**
 * Every page of the catalog. The SDK's `toolkits.get` returns one page and
 * drops the cursor, which hid apps such as Higgsfield past the first 200.
 */
export async function listAllCatalogToolkits(
  client: ComposioToolkitPageClient
): Promise<ComposioCatalogToolkit[]> {
  const items: unknown[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_CATALOG_PAGES; page++) {
    const response = await client.toolkits.list({
      cursor,
      limit: CATALOG_PAGE_SIZE,
    });

    items.push(...response.items);
    cursor = response.next_cursor ?? undefined;

    if (!cursor) {
      break;
    }
  }

  return items.flatMap((item) => parseCatalogToolkitItem(item) ?? []);
}

export async function resolveAuthConfigId(
  composio: ComposioAuthConfigClient,
  toolkitSlug: string
): Promise<string> {
  const slug = toolkitSlug.toLowerCase();

  const listed = await composio.authConfigs.list({
    toolkit: slug,
  });

  const existingId =
    listed.items.find((item) => item.id && item.isComposioManaged === false)
      ?.id ?? listed.items.find((item) => item.id)?.id;

  if (existingId) {
    return existingId;
  }

  const created = await composio.authConfigs.create(slug);

  if (!created.id) {
    throw new Error(`Failed to create Composio auth config for ${slug}.`);
  }

  return created.id;
}

export function parseSessionToolItems(
  inputs: unknown[]
): ComposioCachedToolSummary[] {
  return inputs.flatMap((input) => {
    const tool = SessionToolItemSchema.parse(input);
    const slug = tool.slug ?? tool.name ?? null;

    if (!slug) {
      return [];
    }

    const inputSchema = tool.inputParameters ?? tool.input_parameters ?? {};

    return [
      {
        description: tool.description?.trim() ? tool.description : slug,
        inputSchema,
        name: tool.name ?? slug,
        slug,
      },
    ];
  });
}

export class ComposioApiClient {
  private readonly composio: Composio;

  constructor(apiKey: string) {
    this.composio = new Composio({
      apiKey,
      toolkitVersions: { gmail: "latest", googledrive: "latest" },
    });
  }

  async executeTool(
    slug: string,
    userId: string,
    connectedAccountId: string,
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Composio tool payloads are untyped JSON objects.
    args: Record<string, unknown>
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- Composio tool payloads are untyped JSON passed through to the caller.
  ): Promise<unknown> {
    return this.composio.tools.execute(slug, {
      arguments: args,
      connectedAccountId,
      dangerouslySkipVersionCheck: true,
      userId,
    });
  }

  async listCatalogToolkits(options?: {
    limit?: number;
  }): Promise<ComposioCatalogToolkit[]> {
    if (!options?.limit) {
      return listAllCatalogToolkits(this.composio.getClient());
    }

    const response = await this.composio.toolkits.get({
      limit: options.limit,
    });

    return extractComposioListItems(response)
      .map((item) => parseCatalogToolkitItem(item))
      .filter((item): item is ComposioCatalogToolkit => item !== null);
  }

  async linkToolkitAccount(
    userId: string,
    toolkitSlug: string,
    callbackUrl: string
  ): Promise<ComposioLinkResult> {
    try {
      const authConfigId = await resolveAuthConfigId(
        this.composio,
        toolkitSlug
      );

      const response = await this.composio.connectedAccounts.link(
        userId,
        authConfigId,
        {
          allowMultiple: true,
          callbackUrl,
        }
      );

      const redirectUrl = parseLinkRedirectUrl(response);

      if (!redirectUrl) {
        throw new Error("Composio did not return an OAuth redirect URL.");
      }

      return {
        connectedAccountId: parseConnectionRequestId(response),
        redirectUrl,
      };
    } catch (error) {
      throw error instanceof Error
        ? unwrapComposioError(error)
        : new Error(String(error));
    }
  }

  async deleteConnectedAccount(connectedAccountId: string): Promise<void> {
    await this.composio.connectedAccounts.delete(connectedAccountId);
  }

  async createProfileSession(
    userId: string,
    toolkitSlugs: string[],
    allowedToolsByToolkit: Record<string, string[] | null>,
    connectedAccountsByToolkit: Record<string, string> = {}
  ): Promise<ComposioSessionMcpEndpoint> {
    return this.openSession(
      await this.composio.create(
        userId,
        this.sessionConfig(
          toolkitSlugs,
          allowedToolsByToolkit,
          connectedAccountsByToolkit
        )
      )
    );
  }

  async listSessionTools(
    session: ComposioSessionMcpEndpoint
  ): Promise<ComposioCachedToolSummary[]> {
    const tools = await this.composio.tools.getRawToolRouterSessionTools(
      session.sessionId
    );

    return parseSessionToolItems(extractComposioListItems(tools));
  }

  private sessionConfig(
    toolkitSlugs: string[],
    allowedToolsByToolkit: Record<string, string[] | null>,
    connectedAccountsByToolkit: Record<string, string> = {}
  ) {
    const tools: Record<string, { enable: string[] }> = {};

    for (const [toolkitSlug, allowedActions] of Object.entries(
      allowedToolsByToolkit
    )) {
      if (allowedActions && allowedActions.length > 0) {
        tools[toolkitSlug] = { enable: allowedActions };
      }
    }

    const connectedAccounts =
      Object.keys(connectedAccountsByToolkit).length > 0
        ? connectedAccountsByToolkit
        : undefined;

    return {
      connectedAccounts,
      mcp: true as const,
      sessionPreset: "direct_tools" as const,
      toolkits: toolkitSlugs.length > 0 ? { enable: toolkitSlugs } : undefined,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
    };
  }

  private openSession(session: {
    sessionId?: string;
    mcp?: { url?: string; headers?: Record<string, string> };
  }): ComposioSessionMcpEndpoint {
    const sessionId = session.sessionId;
    const url = session.mcp?.url;

    if (!(sessionId && url)) {
      throw new Error("Composio session did not include MCP endpoint details.");
    }

    return {
      headers: session.mcp?.headers,
      sessionId,
      url,
    };
  }
}
