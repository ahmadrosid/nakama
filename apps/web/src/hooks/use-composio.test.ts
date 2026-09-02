import { describe, expect, test } from "bun:test";
import { isAllowedComposioRedirectUrl } from "./use-composio";

describe("isAllowedComposioRedirectUrl", () => {
  test("allows https composio.dev and subdomains", () => {
    expect(
      isAllowedComposioRedirectUrl("https://backend.composio.dev/api/v3/s/abc")
    ).toBe(true);
    expect(
      isAllowedComposioRedirectUrl("https://composio.dev/connect?toolkit=gmail")
    ).toBe(true);
    expect(
      isAllowedComposioRedirectUrl("https://PLATFORM.COMPOSIO.DEV/oauth/start")
    ).toBe(true);
  });

  test("rejects non-https, foreign hosts, and garbage", () => {
    expect(
      isAllowedComposioRedirectUrl("http://backend.composio.dev/api/v3/s/abc")
    ).toBe(false);
    expect(
      isAllowedComposioRedirectUrl("https://evil.com/?next=composio.dev")
    ).toBe(false);
    expect(
      isAllowedComposioRedirectUrl("https://composio.dev.evil.com/phish")
    ).toBe(false);
    expect(isAllowedComposioRedirectUrl("not a url")).toBe(false);
  });
});
