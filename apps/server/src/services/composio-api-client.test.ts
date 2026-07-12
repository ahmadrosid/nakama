import { describe, expect, test } from "bun:test";
import { extractComposioListItems, parseCatalogToolkitItem, parseLinkRedirectUrl } from "./composio-api-client";

describe("extractComposioListItems", () => {
  test("accepts bare arrays returned by newer Composio SDK responses", () => {
    expect(extractComposioListItems([{ slug: "gmail" }])).toEqual([{ slug: "gmail" }]);
  });

  test("accepts legacy { items } wrappers", () => {
    expect(extractComposioListItems({ items: [{ slug: "slack" }] })).toEqual([{ slug: "slack" }]);
  });

  test("returns empty array for missing data", () => {
    expect(extractComposioListItems(null)).toEqual([]);
    expect(extractComposioListItems({})).toEqual([]);
  });
});

describe("parseCatalogToolkitItem", () => {
  test("maps logo from toolkit meta", () => {
    expect(
      parseCatalogToolkitItem({
        slug: "gmail",
        name: "Gmail",
        meta: {
          description: "Email",
          logo: "https://logos.composio.dev/api/gmail",
        },
      }),
    ).toEqual({
      slug: "gmail",
      name: "Gmail",
      description: "Email",
      logoUrl: "https://logos.composio.dev/api/gmail",
    });
  });

  test("returns null logo when meta logo is missing", () => {
    expect(
      parseCatalogToolkitItem({
        slug: "slack",
        name: "Slack",
        meta: { description: "Chat" },
      }),
    ).toEqual({
      slug: "slack",
      name: "Slack",
      description: "Chat",
      logoUrl: null,
    });
  });
});

describe("parseLinkRedirectUrl", () => {
  test("reads redirectUrl and snake_case variants", () => {
    expect(parseLinkRedirectUrl({ redirectUrl: "https://oauth.example/start" })).toBe(
      "https://oauth.example/start",
    );
    expect(parseLinkRedirectUrl({ redirect_url: "https://oauth.example/legacy" })).toBe(
      "https://oauth.example/legacy",
    );
  });

  test("reads nested connection request payloads", () => {
    expect(
      parseLinkRedirectUrl({
        connectionRequest: { redirectUrl: "https://oauth.example/nested" },
      }),
    ).toBe("https://oauth.example/nested");
  });
});
