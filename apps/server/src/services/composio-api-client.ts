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

interface ComposioSessionConfig {
  connectedAccounts?: { enable: string[] };
  mcp: true;
  sessionPreset: "direct_tools";
  toolkits?: { enable: string[] };
  tools?: Record<string, { enable: string[] }>;
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
  const slug = isString(item.slug)
    ? item.slug
    : isString(item.name)
      ? item.name.toLowerCase()
      : null;

  if (!slug) {
    return null;
  }

  return {
    description: isString(item.meta?.description)
      ? item.meta.description
      : null,
    logoUrl: isString(item.meta?.logo) ? item.meta.logo : null,
    name: isString(item.name) ? item.name : slug,
    slug: slug.toLowerCase(),
  };
}

export function parseLinkRedirectUrl<T>(response: T): string | null {
  if (isString(response) && response.startsWith("http")) {
    return response;
  }

  const record = readRecord(response);

  if (!record) {
    return null;
  }

  for (const key of [
    "redirectUrl",
    "redirect_url",
    "authorizationUrl",
    "authorization_url",
    "url",
  ]) {
    const value = record.get(key);

    if (isString(value) && value) {
      return value;
    }
  }

  for (const nestedKey of ["connectionRequest", "data", "connection"]) {
    const nested = record.get(nestedKey);

    if (nested instanceof Object) {
      const nestedUrl = parseLinkRedirectUrl(nested);

      if (nestedUrl) {
        return nestedUrl;
      }
    }
  }

  return null;
}

function parseConnectionRequestId<T>(response: T): string | undefined {
  const record = readRecord(response);

  if (!record) {
    return;
  }

  const id = record.get("id");

  if (isString(id)) {
    return id;
  }

  const connectedAccountId = record.get("connectedAccountId");

  if (isString(connectedAccountId)) {
    return connectedAccountId;
  }

  const connectedAccountIdSnake = record.get("connected_account_id");

  if (isString(connectedAccountIdSnake)) {
    return connectedAccountIdSnake;
  }
}

export function unwrapComposioError(cause: unknown): Error {
  if (!(cause instanceof Error)) {
    return new Error(String(cause));
  }

  const nestedCause = "cause" in cause ? cause.cause : undefined;

  if (nestedCause instanceof Error && nestedCause.message.trim()) {
    return new Error(`${cause.message}: ${nestedCause.message}`, {
      cause: nestedCause,
    });
  }

  return cause;
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
  items: Array<{
    slug?: unknown;
    name?: unknown;
    description?: unknown;
    inputParameters?: unknown;
    input_parameters?: unknown;
  }>
): ComposioCachedToolSummary[] {
  return items.flatMap((tool) => {
    const slug = isString(tool.slug)
      ? tool.slug
      : isString(tool.name)
        ? tool.name
        : null;

    if (!slug) {
      return [];
    }

    const inputSchema =
      readRecord(tool.inputParameters) ?? readRecord(tool.input_parameters);

    return [
      {
        description:
          isString(tool.description) && tool.description.trim()
            ? tool.description
            : slug,
        inputSchema: inputSchema ? Object.fromEntries(inputSchema) : {},
        name: isString(tool.name) ? tool.name : slug,
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

    const config: ComposioSessionConfig = {
      mcp: true as const,
      sessionPreset: "direct_tools" as const,
      toolkits: toolkitSlugs.length > 0 ? { enable: toolkitSlugs } : undefined,
    };

    if (connectedAccounts) {
      config.connectedAccounts = connectedAccounts;
    }

    if (Object.keys(tools).length > 0) {
      config.tools = tools;
    }

    return config;
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

function readRecord<T>(value: T): Map<string, unknown> | undefined {
  if (!(value instanceof Object)) {
    return;
  }

  return new Map(Object.entries(value));
}

function isString<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}
