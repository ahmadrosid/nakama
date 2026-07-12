import { Composio } from "@composio/core";
import type { ComposioCachedToolSummary } from "@nakama/core";

export interface ComposioCatalogToolkit {
  slug: string;
  name: string;
  description: string | null;
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

export class SdkComposioApiClient implements ComposioApiClient {
  private readonly composio: Composio;

  constructor(apiKey: string) {
    this.composio = new Composio({ apiKey });
  }

  async listCatalogToolkits(): Promise<ComposioCatalogToolkit[]> {
    const response = await this.composio.toolkits.getToolkits({ limit: 200 });
    const items = Array.isArray(response.items) ? response.items : [];

    return items
      .map((item) => {
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
          description:
            typeof item.meta?.description === "string" ? item.meta.description : null,
        };
      })
      .filter((item): item is ComposioCatalogToolkit => item !== null);
  }

  async linkToolkitAccount(
    userId: string,
    toolkitSlug: string,
    callbackUrl: string,
  ): Promise<ComposioLinkResult> {
    const response = await this.composio.connectedAccounts.link(userId, toolkitSlug, {
      callbackUrl,
    });

    const redirectUrl =
      typeof response.redirectUrl === "string"
        ? response.redirectUrl
        : typeof response.redirect_url === "string"
          ? response.redirect_url
          : null;

    if (!redirectUrl) {
      throw new Error("Composio did not return an OAuth redirect URL.");
    }

    return {
      redirectUrl,
      connectedAccountId:
        typeof response.connectedAccountId === "string"
          ? response.connectedAccountId
          : typeof response.connected_account_id === "string"
            ? response.connected_account_id
            : undefined,
    };
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

    const items = Array.isArray(tools.items) ? tools.items : [];

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
