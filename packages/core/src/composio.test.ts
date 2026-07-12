import { describe, expect, test } from "bun:test";
import { isComposioConfigured, composioOrgUserId } from "./composio-config";
import {
  normalizeEnableComposioToolkitRequest,
  normalizeUpdateProfileComposioToolkitsRequest,
} from "./composio";

describe("composio-config", () => {
  test("isComposioConfigured is false without API key", () => {
    expect(isComposioConfigured({})).toBe(false);
    expect(isComposioConfigured({ COMPOSIO_API_KEY: "   " })).toBe(false);
  });

  test("isComposioConfigured is true with API key", () => {
    expect(isComposioConfigured({ COMPOSIO_API_KEY: "ck-test" })).toBe(true);
  });

  test("composioOrgUserId namespaces org id", () => {
    expect(composioOrgUserId("org_123")).toBe("nakama:org:org_123");
  });
});

describe("normalizeEnableComposioToolkitRequest", () => {
  test("accepts valid toolkit slug", () => {
    expect(
      normalizeEnableComposioToolkitRequest({ toolkitSlug: "Gmail" }),
    ).toEqual({ toolkitSlug: "gmail" });
  });

  test("rejects invalid toolkit slug", () => {
    expect(() =>
      normalizeEnableComposioToolkitRequest({ toolkitSlug: "bad slug" }),
    ).toThrow(/toolkitSlug/);
  });
});

describe("normalizeUpdateProfileComposioToolkitsRequest", () => {
  test("accepts toolkit assignment with action allowlist", () => {
    expect(
      normalizeUpdateProfileComposioToolkitsRequest({
        assignments: [
          {
            toolkitId: "ctk_1",
            allowedActions: ["GMAIL_SEND_EMAIL"],
          },
        ],
      }),
    ).toEqual({
      assignments: [
        {
          toolkitId: "ctk_1",
          allowedActions: ["GMAIL_SEND_EMAIL"],
        },
      ],
    });
  });

  test("treats empty allowlist as null", () => {
    expect(
      normalizeUpdateProfileComposioToolkitsRequest({
        assignments: [{ toolkitId: "ctk_1", allowedActions: [] }],
      }),
    ).toEqual({
      assignments: [{ toolkitId: "ctk_1", allowedActions: null }],
    });
  });

  test("rejects invalid action slug", () => {
    expect(() =>
      normalizeUpdateProfileComposioToolkitsRequest({
        assignments: [{ toolkitId: "ctk_1", allowedActions: ["bad-action"] }],
      }),
    ).toThrow(/allowedActions/);
  });
});
