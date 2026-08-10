import { Composio } from "@composio/core";
import type { ComposioCachedToolSummary } from "@nakama/core";

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

export interface ComposioApiClient {
  createProfileSession(
    userId: string,
    toolkitSlugs: string[],
    allowedToolsByToolkit: Record<string, string[] | null>,
    connectedAccountsByToolkit?: Record<string, string>
  ): Promise<ComposioSessionMcpEndpoint>;
  deleteConnectedAccount(connectedAccountId: string): Promise<void>;
  linkToolkitAccount(
    userId: string,
    toolkitSlug: string,
    callbackUrl: string
  ): Promise<ComposioLinkResult>;
  listCatalogToolkits(options?: {
    limit?: number;
  }): Promise<ComposioCatalogToolkit[]>;
  listSessionTools(
    session: ComposioSessionMcpEndpoint
  ): Promise<ComposioCachedToolSummary[]>;
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

export function parseCatalogToolkitItem(item: {
  slug?: unknown;
  name?: unknown;
  meta?: { description?: unknown; logo?: unknown };
}): ComposioCatalogToolkit | null {
  const slug =
    typeof item.slug === "string"
      ? item.slug
      : typeof item.name === "string"
        ? item.name.toLowerCase()
        : null;

  if (!slug) {
    return null;
  }

  return {
    description:
      typeof item.meta?.description === "string" ? item.meta.description : null,
    logoUrl: typeof item.meta?.logo === "string" ? item.meta.logo : null,
    name: typeof item.name === "string" ? item.name : slug,
    slug: slug.toLowerCase(),
  };
}

export function parseLinkRedirectUrl(response: unknown): string | null {
  if (typeof response === "string" && response.startsWith("http")) {
    return response;
  }

  if (!response || typeof response !== "object") {
    return null;
  }

  const record = response as Record<string, unknown>;
  for (const key of [
    "redirectUrl",
    "redirect_url",
    "authorizationUrl",
    "authorization_url",
    "url",
  ]) {
    if (typeof record[key] === "string" && record[key]) {
      return record[key] as string;
    }
  }

  for (const nestedKey of ["connectionRequest", "data", "connection"]) {
    const nested = record[nestedKey];
    if (nested && typeof nested === "object") {
      const nestedUrl = parseLinkRedirectUrl(nested);
      if (nestedUrl) {
        return nestedUrl;
      }
    }
  }

  return null;
}

export function parseConnectionRequestId(
  response: unknown
): string | undefined {
  if (!response || typeof response !== "object") {
    return;
  }

  const record = response as Record<string, unknown>;
  if (typeof record.id === "string") {
    return record.id;
  }

  if (typeof record.connectedAccountId === "string") {
    return record.connectedAccountId;
  }

  if (typeof record.connected_account_id === "string") {
    return record.connected_account_id;
  }
}

export function unwrapComposioError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(String(error));
  }

  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message.trim()) {
    return new Error(`${error.message}: ${cause.message}`, { cause });
  }

  return error;
}

type ComposioAuthConfigClient = {
  authConfigs: {
    list(query?: {
      toolkit?: string;
      isComposioManaged?: boolean;
    }): Promise<{ items: Array<{ id?: string }> }>;
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
    isComposioManaged: true,
    toolkit: slug,
  });

  const existingId = listed.items.find((item) => item.id)?.id;
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
  items: Array<{
    slug?: unknown;
    name?: unknown;
    description?: unknown;
    inputParameters?: unknown;
    input_parameters?: unknown;
  }>
): ComposioCachedToolSummary[] {
  return items
    .map((tool) => {
      const slug =
        typeof tool.slug === "string"
          ? tool.slug
          : typeof tool.name === "string"
            ? tool.name
            : null;

      if (!slug) {
        return null;
      }

      const inputSchema =
        typeof tool.inputParameters === "object" &&
        tool.inputParameters !== null
          ? (tool.inputParameters as Record<string, unknown>)
          : typeof tool.input_parameters === "object" &&
              tool.input_parameters !== null
            ? (tool.input_parameters as Record<string, unknown>)
            : {};

      return {
        description:
          typeof tool.description === "string" && tool.description.trim()
            ? tool.description
            : slug,
        inputSchema,
        name: typeof tool.name === "string" ? tool.name : slug,
        slug,
      };
    })
    .filter((tool): tool is ComposioCachedToolSummary => tool !== null);
}

export class SdkComposioApiClient implements ComposioApiClient {
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
      throw unwrapComposioError(error);
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
      mcp: true as const,
      sessionPreset: "direct_tools" as const,
      toolkits: toolkitSlugs.length > 0 ? { enable: toolkitSlugs } : undefined,
      ...(connectedAccounts ? { connectedAccounts } : {}),
      ...(Object.keys(tools).length > 0 ? { tools } : {}),
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

export function createComposioApiClient(
  apiKey: string | undefined
): ComposioApiClient | null {
  if (!apiKey?.trim()) {
    return null;
  }

  return new SdkComposioApiClient(apiKey.trim());
}
