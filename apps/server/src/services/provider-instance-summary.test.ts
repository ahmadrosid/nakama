import { describe, expect, test } from "bun:test";
import type { ProviderInstance } from "@nakama/core";
import { CHATGPT_JWT_CLAIM_PATH } from "../providers/chatgpt/oauth";
import { toProviderInstanceSummary } from "./provider-instance-helpers";

function createProviderInstance(
  overrides: Partial<ProviderInstance> &
    Pick<ProviderInstance, "id" | "type" | "label">
): ProviderInstance {
  return {
    apiKey: "test-key",
    createdAt: "2026-06-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("toProviderInstanceSummary", () => {
  const freeToken = `h.${Buffer.from(
    JSON.stringify({
      [CHATGPT_JWT_CLAIM_PATH]: { chatgpt_plan_type: "free" },
    })
  ).toString("base64url")}.s`;

  test("reports the plan of a connected ChatGPT account", () => {
    const summary = toProviderInstanceSummary(
      createProviderInstance({
        apiKey: "",
        chatgptAccessToken: freeToken,
        chatgptAccountId: "acct_1",
        chatgptRefreshToken: "refresh",
        id: "chatgpt",
        label: "ChatGPT",
        type: "chatgpt",
      }),
      0
    );

    expect(summary.chatgptPlanType).toBe("free");
  });

  test("leaves the plan out for a disconnected ChatGPT account", () => {
    const summary = toProviderInstanceSummary(
      createProviderInstance({
        apiKey: "",
        chatgptAccessToken: freeToken,
        id: "chatgpt",
        label: "ChatGPT",
        type: "chatgpt",
      }),
      0
    );

    expect(summary.chatgptPlanType).toBeUndefined();
  });

  test("leaves the plan out for a connected ChatGPT account with no access token", () => {
    const summary = toProviderInstanceSummary(
      createProviderInstance({
        apiKey: "",
        chatgptAccountId: "acct_1",
        chatgptRefreshToken: "refresh",
        id: "chatgpt",
        label: "ChatGPT",
        type: "chatgpt",
      }),
      0
    );

    expect(summary.chatgptPlanType).toBeUndefined();
  });

  test("leaves the plan out for other provider types", () => {
    const summary = toProviderInstanceSummary(
      createProviderInstance({
        chatgptAccessToken: freeToken,
        id: "openai",
        label: "OpenAI",
        type: "openai",
      }),
      0
    );

    expect(summary.chatgptPlanType).toBeUndefined();
  });
});
