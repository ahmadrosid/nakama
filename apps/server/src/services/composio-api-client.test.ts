import { describe, expect, test } from "bun:test";
import {
  extractComposioListItems,
  listAllCatalogToolkits,
  parseCatalogToolkitItem,
  parseLinkRedirectUrl,
  parseSessionToolItems,
  resolveAuthConfigId,
  unwrapComposioError,
} from "./composio-api-client";

describe("extractComposioListItems", () => {
  test("accepts bare arrays returned by newer Composio SDK responses", () => {
    expect(extractComposioListItems([{ slug: "gmail" }])).toEqual([
      { slug: "gmail" },
    ]);
  });

  test("accepts legacy { items } wrappers", () => {
    expect(extractComposioListItems({ items: [{ slug: "slack" }] })).toEqual([
      { slug: "slack" },
    ]);
  });

  test("returns empty array for missing data", () => {
    expect(extractComposioListItems(null)).toEqual([]);
    expect(extractComposioListItems({})).toEqual([]);
  });
});

describe("parseCatalogToolkitItem", () => {
  test("ignores malformed optional catalog fields", () => {
    expect(
      parseCatalogToolkitItem({
        meta: { logo: false },
        name: 42,
        slug: "gmail",
      })
    ).toEqual({
      description: null,
      logoUrl: null,
      name: "gmail",
      slug: "gmail",
    });
  });
  test("maps logo from toolkit meta", () => {
    expect(
      parseCatalogToolkitItem({
        meta: {
          description: "Email",
          logo: "https://logos.composio.dev/api/gmail",
        },
        name: "Gmail",
        slug: "gmail",
      })
    ).toEqual({
      description: "Email",
      logoUrl: "https://logos.composio.dev/api/gmail",
      name: "Gmail",
      slug: "gmail",
    });
  });

  test("returns null logo when meta logo is missing", () => {
    expect(
      parseCatalogToolkitItem({
        meta: { description: "Chat" },
        name: "Slack",
        slug: "slack",
      })
    ).toEqual({
      description: "Chat",
      logoUrl: null,
      name: "Slack",
      slug: "slack",
    });
  });
});

describe("parseLinkRedirectUrl", () => {
  test("handles direct URLs and invalid optional URL fields", () => {
    expect(parseLinkRedirectUrl("https://oauth.example/direct")).toBe(
      "https://oauth.example/direct"
    );
    expect(parseLinkRedirectUrl("invalid")).toBeNull();
    expect(parseLinkRedirectUrl({ redirectUrl: 42 })).toBeNull();
    expect(
      parseLinkRedirectUrl({
        authorization_url: "https://oauth.example/fallback",
        redirectUrl: null,
      })
    ).toBe("https://oauth.example/fallback");
  });
  test("reads redirectUrl and snake_case variants", () => {
    expect(
      parseLinkRedirectUrl({ redirectUrl: "https://oauth.example/start" })
    ).toBe("https://oauth.example/start");
    expect(
      parseLinkRedirectUrl({ redirect_url: "https://oauth.example/legacy" })
    ).toBe("https://oauth.example/legacy");
  });

  test("reads nested connection request payloads", () => {
    expect(
      parseLinkRedirectUrl({
        connectionRequest: { redirectUrl: "https://oauth.example/nested" },
      })
    ).toBe("https://oauth.example/nested");
  });
});

describe("listAllCatalogToolkits", () => {
  test("follows the cursor to the last page", async () => {
    const cursors: (string | undefined)[] = [];

    const client = {
      toolkits: {
        async list(query: { cursor?: string; limit: number }) {
          cursors.push(query.cursor);

          return query.cursor
            ? { items: [{ name: "Higgsfield", slug: "higgsfield" }] }
            : {
                items: [{ name: "Notion", slug: "notion" }],
                next_cursor: "page-2",
              };
        },
      },
    };

    const catalog = await listAllCatalogToolkits(client);

    expect(catalog.map((toolkit) => toolkit.slug)).toEqual([
      "notion",
      "higgsfield",
    ]);
    expect(cursors).toEqual([undefined, "page-2"]);
  });

  test("stops when the cursor never ends", async () => {
    let calls = 0;

    const client = {
      toolkits: {
        async list() {
          calls++;

          return { items: [], next_cursor: "again" };
        },
      },
    };

    await expect(listAllCatalogToolkits(client)).resolves.toEqual([]);
    expect(calls).toBe(20);
  });
});

describe("resolveAuthConfigId", () => {
  test("uses a custom auth config when the toolkit has no managed credentials", async () => {
    const composio = {
      authConfigs: {
        async create() {
          throw new Error("should not create when a custom config exists");
        },
        async list(query: { toolkit?: string }) {
          expect(query).toEqual({ toolkit: "metaads" });

          return {
            items: [
              { id: "ac_managed", isComposioManaged: true },
              { id: "ac_custom", isComposioManaged: false },
            ],
          };
        },
      },
    };

    await expect(resolveAuthConfigId(composio, "MetaAds")).resolves.toBe(
      "ac_custom"
    );
  });

  test("reuses an existing composio-managed auth config", async () => {
    const composio = {
      authConfigs: {
        async create() {
          throw new Error("should not create when existing config is present");
        },
        async list() {
          return { items: [{ id: "ac_existing" }] };
        },
      },
    };

    await expect(resolveAuthConfigId(composio, "gmail")).resolves.toBe(
      "ac_existing"
    );
  });

  test("creates a composio-managed auth config when none exists", async () => {
    const composio = {
      authConfigs: {
        async create(toolkitSlug: string) {
          expect(toolkitSlug).toBe("gmail");

          return { id: "ac_new" };
        },
        async list() {
          return { items: [] };
        },
      },
    };

    await expect(resolveAuthConfigId(composio, "Gmail")).resolves.toBe(
      "ac_new"
    );
  });
});

describe("unwrapComposioError", () => {
  test("includes nested API cause message", () => {
    const error = new Error("Failed to create connected account link", {
      cause: new Error("auth_config_id is invalid"),
    });

    expect(unwrapComposioError(error).message).toBe(
      "Failed to create connected account link: auth_config_id is invalid"
    );
  });
});

describe("parseSessionToolItems", () => {
  test("maps composio tool list items to cached tool summaries", () => {
    expect(
      parseSessionToolItems([
        {
          description: "Send an email",
          inputParameters: { properties: {}, type: "object" },
          name: "Send Email",
          slug: "GMAIL_SEND_EMAIL",
        },
      ])
    ).toEqual([
      {
        description: "Send an email",
        inputSchema: { properties: {}, type: "object" },
        name: "Send Email",
        slug: "GMAIL_SEND_EMAIL",
      },
    ]);
  });
});
