import { describe, expect, test } from "bun:test";
import {
  CLOUDFLARE_API_ROOT,
  cloudflareBaseUrlFromAccountId,
  resolveCloudflareAccountInput,
} from "./cloudflare-provider-config";

describe("resolveCloudflareAccountInput", () => {
  test("turns an account ID into the Workers AI base URL", () => {
    expect(resolveCloudflareAccountInput("abc123")).toBe(
      `${CLOUDFLARE_API_ROOT}/abc123/ai/v1`
    );
  });

  test("accepts a full Workers AI URL", () => {
    expect(
      resolveCloudflareAccountInput(
        "https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1/"
      )
    ).toBe(`${CLOUDFLARE_API_ROOT}/abc123/ai/v1`);
  });

  test("rejects empty or invalid input", () => {
    expect(resolveCloudflareAccountInput("")).toBeNull();
    expect(resolveCloudflareAccountInput("not a url")).toBeNull();
    expect(resolveCloudflareAccountInput("https://")).toBeNull();
  });
});

describe("cloudflareBaseUrlFromAccountId", () => {
  test("builds the OpenAI-compatible Workers AI path", () => {
    expect(cloudflareBaseUrlFromAccountId("acct")).toBe(
      `${CLOUDFLARE_API_ROOT}/acct/ai/v1`
    );
  });
});
