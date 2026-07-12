import { Composio } from "@composio/core";
import type { ComposioCachedToolSummary } from "@nakama/core";

export interface ComposioCatalogToolkit {
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
}

export interface ComposioLinkResult {
  redirectUrl: string;
  connectedAccountId?: string;
}

export interface ComposioSessionMcpEndpoint {
  sessionId: string;
  url: string;
  headers?: Record<string, string>;
}

export interface ComposioApiClient {
  listCatalogToolkits(): Promise<ComposioCatalogToolkit[]>;
  linkToolkitAccount(
    userId: string,
    toolkitSlug: string,
    callbackUrl: string,
  ): Promise<ComposioLinkResult>;
  deleteConnectedAccount(connectedAccountId: string): Promise<void>;
  createProfileSession(
    userId: string,
    toolkitSlugs: string[],
    allowedToolsByToolkit: Record<string, string[] | null>,
  ): Promise<ComposioSessionMcpEndpoint>;
  reuseProfileSession(
    sessionId: string,
    toolkitSlugs: string[],
    allowedToolsByToolkit: Record<string, string[] | null>,
  ): Promise<ComposioSessionMcpEndpoint>;
  listSessionTools(session: ComposioSessionMcpEndpoint): Promise<ComposioCachedToolSummary[]>;
}

export function extractComposioListItems<T>(
  response: { items?: T[] } | T[] | null | undefined,
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
    slug: slug.toLowerCase(),
    name: typeof item.name === "string" ? item.name : slug,
    description: typeof item.meta?.description === "string" ? item.meta.description : null,
    logoUrl: typeof item.meta?.logo === "string" ? item.meta.logo : null,
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

export function parseConnectionRequestId(response: unknown): string | undefined {
  if (!response || typeof response !== "object") {
    return undefined;
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

  return undefined;
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
      options?: { type?: string },
    ): Promise<{ id?: string }>;
  };
};

export async function resolveAuthConfigId(
  composio: ComposioAuthConfigClient,
  toolkitSlug: string,
): Promise<string> {
  const slug = toolkitSlug.toLowerCase();
  const listed = await composio.authConfigs.list({
    toolkit: slug,
    isComposioManaged: true,
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

export class SdkComposioApiClient implements ComposioApiClient {
  private readonly composio: Composio;

  constructor(apiKey: string) {
    this.composio = new Composio({ apiKey });
  }

  async listCatalogToolkits(): Promise<ComposioCatalogToolkit[]> {
    const response = await this.composio.toolkits.getToolkits({ limit: 200 });
    const items = extractComposioListItems(response);

    return items
      .map((item) => parseCatalogToolkitItem(item))
      .filter((item): item is ComposioCatalogToolkit => item !== null);
  }

  async linkToolkitAccount(
    userId: string,
    toolkitSlug: string,
    callbackUrl: string,
  ): Promise<ComposioLinkResult> {
    try {
      const authConfigId = await resolveAuthConfigId(this.composio, toolkitSlug);
      const response = await this.composio.connectedAccounts.link(userId, authConfigId, {
        callbackUrl,
        allowMultiple: true,
      });

      const redirectUrl = parseLinkRedirectUrl(response);

      if (!redirectUrl) {
        throw new Error("Composio did not return an OAuth redirect URL.");
      }

      return {
        redirectUrl,
        connectedAccountId: parseConnectionRequestId(response),
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
  ): Promise<ComposioSessionMcpEndpoint> {
    return this.openSession(
      await this.composio.create(userId, this.sessionConfig(toolkitSlugs, allowedToolsByToolkit)),
    );
  }

  async reuseProfileSession(
    sessionId: string,
    toolkitSlugs: string[],
    allowedToolsByToolkit: Record<string, string[] | null>,
  ): Promise<ComposioSessionMcpEndpoint> {
    return this.openSession(
      await this.composio.use(sessionId, this.sessionConfig(toolkitSlugs, allowedToolsByToolkit)),
    );
  }

  async listSessionTools(session: ComposioSessionMcpEndpoint): Promise<ComposioCachedToolSummary[]> {
    const tools = await this.composio.tools.list({
      sessionId: session.sessionId,
      limit: 500,
    });

    const items = extractComposioListItems(tools);

    return items
      .map((tool) => {
        const slug = typeof tool.slug === "string" ? tool.slug : typeof tool.name === "string" ? tool.name : null;

        if (!slug) {
          return null;
        }

        const inputSchema =
          typeof tool.inputParameters === "object" && tool.inputParameters !== null
            ? (tool.inputParameters as Record<string, unknown>)
            : typeof tool.input_parameters === "object" && tool.input_parameters !== null
              ? (tool.input_parameters as Record<string, unknown>)
              : {};

        return {
          slug,
          name: typeof tool.name === "string" ? tool.name : slug,
          description:
            typeof tool.description === "string" && tool.description.trim()
              ? tool.description
              : slug,
          inputSchema,
        };
      })
      .filter((tool): tool is ComposioCachedToolSummary => tool !== null);
  }

  private sessionConfig(
    toolkitSlugs: string[],
    allowedToolsByToolkit: Record<string, string[] | null>,
  ) {
    const tools: Record<string, { enable: string[] }> = {};

    for (const [toolkitSlug, allowedActions] of Object.entries(allowedToolsByToolkit)) {
      if (allowedActions && allowedActions.length > 0) {
        tools[toolkitSlug] = { enable: allowedActions };
      }
    }

    return {
      mcp: true as const,
      sessionPreset: "direct_tools" as const,
      toolkits: toolkitSlugs.length > 0 ? { enable: toolkitSlugs } : undefined,
      ...(Object.keys(tools).length > 0 ? { tools } : {}),
    };
  }

  private openSession(session: {
    sessionId?: string;
    mcp?: { url?: string; headers?: Record<string, string> };
  }): ComposioSessionMcpEndpoint {
    const sessionId = session.sessionId;
    const url = session.mcp?.url;

    if (!sessionId || !url) {
      throw new Error("Composio session did not include MCP endpoint details.");
    }

    return {
      sessionId,
      url,
      headers: session.mcp?.headers,
    };
  }
}

export function createComposioApiClient(apiKey: string | undefined): ComposioApiClient | null {
  if (!apiKey?.trim()) {
    return null;
  }

  return new SdkComposioApiClient(apiKey.trim());
}
