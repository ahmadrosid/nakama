import { Composio } from "@composio/core";
import type { ComposioCachedToolSummary } from "@nakama/core";
import { z } from "zod";

const CatalogToolkitItemSchema = z.object({
  meta: z
    .object({
      description: z.string().catch(undefined).optional(),
      logo: z.string().catch(undefined).optional(),
    })
    .catch({})
    .optional(),
  name: z.string().catch(undefined).optional(),
  slug: z.string().catch(undefined).optional(),
});

const ComposioRecordSchema = z.record(z.string(), z.json());

const LinkResponseSchema = z.union([
  z.string().transform((directUrl) => ({ directUrl })),
  z
    .object({
      authorization_url: z.string().catch(undefined).optional(),
      authorizationUrl: z.string().catch(undefined).optional(),
      connected_account_id: z.string().catch(undefined).optional(),
      connectedAccountId: z.string().catch(undefined).optional(),
      connection: z.union([z.string(), z.object({}).passthrough()]).optional(),
      connectionRequest: z
        .union([z.string(), z.object({}).passthrough()])
        .optional(),
      data: z.union([z.string(), z.object({}).passthrough()]).optional(),
      id: z.string().catch(undefined).optional(),
      redirect_url: z.string().catch(undefined).optional(),
      redirectUrl: z.string().catch(undefined).optional(),
      url: z.string().catch(undefined).optional(),
    })
    .passthrough()
    .transform((response) => ({ ...response, directUrl: undefined })),
]);

const SessionToolItemSchema = z.object({
  description: z.string().catch(undefined).optional(),
  input_parameters: ComposioRecordSchema.catch(undefined).optional(),
  inputParameters: ComposioRecordSchema.catch(undefined).optional(),
  name: z.string().catch(undefined).optional(),
  slug: z.string().catch(undefined).optional(),
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
  input: z.input<typeof CatalogToolkitItemSchema>
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
  input: z.input<typeof LinkResponseSchema>
): string | null {
  const response = LinkResponseSchema.parse(input);

  if (response.directUrl?.startsWith("http")) {
    return response.directUrl;
  }

  for (const key of [
    "redirectUrl",
    "redirect_url",
    "authorizationUrl",
    "authorization_url",
    "url",
  ]) {
    const value = response[key];

    if (value) {
      return value;
    }
  }

  for (const nestedKey of ["connectionRequest", "data", "connection"]) {
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
  input: z.input<typeof LinkResponseSchema>
): string | undefined {
  const response = LinkResponseSchema.parse(input);

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
  inputs: Array<z.input<typeof SessionToolItemSchema>>
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
    this.composio = new Composio({ apiKey });
  }

  async listCatalogToolkits(options?: {
    limit?: number;
  }): Promise<ComposioCatalogToolkit[]> {
    const limit = options?.limit ?? 200;
    const response = await this.composio.toolkits.getToolkits({ limit });
    const items = extractComposioListItems(response);

    return items
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
