import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createHonoApp } from "./app";
import { AuthService } from "../services/auth-service";
import { AgentService } from "../services/agent-service";
import { OrgService } from "../services/org-service";
import {
  LOCAL_CLIENT_EMAIL,
  seedLocalClientUser,
  seedOrgForUser,
  TEST_ORG_ID,
} from "./test-org-helpers";
import { loadLocalAuthToken } from "@nakama/core";
import { setupTestConfigDir } from "../test-config-dir";

setupTestConfigDir("nakama-inference-gateway-route-test-");

const previousGatewayFlag = process.env.NAKAMA_INFERENCE_GATEWAY_ENABLED;

describe("inference gateway route", () => {
  beforeEach(() => {
    process.env.NAKAMA_INFERENCE_GATEWAY_ENABLED = "1";
  });

  afterEach(() => {
    if (previousGatewayFlag === undefined) {
      delete process.env.NAKAMA_INFERENCE_GATEWAY_ENABLED;
    } else {
      process.env.NAKAMA_INFERENCE_GATEWAY_ENABLED = previousGatewayFlag;
    }
  });

  test("accepts Anthropic x-api-key auth for coding-agent clients", async () => {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const authService = new AuthService();
    await seedLocalClientUser(databaseAdapter);
    await seedOrgForUser(databaseAdapter, LOCAL_CLIENT_EMAIL, TEST_ORG_ID);
    const token = await loadLocalAuthToken();
    const now = new Date().toISOString();

    await databaseAdapter.upsertProfile({
      id: "profile_default",
      name: "Default",
      systemPrompt: "You are helpful.",
      model: "anthropic:claude-sonnet-4-6",
      isSuper: true,
      orgId: TEST_ORG_ID,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });

    const app = createHonoApp({
      agent: new AgentService(null, null, databaseAdapter),
      automationService: {} as never,
      taskService: {} as never,
      systemStatus: {} as never,
      workerManager: {} as never,
      authService,
      orgService: new OrgService(databaseAdapter),
      databaseAdapter,
    });

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/messages?profileId=profile_default", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": token,
          "X-Org-Id": TEST_ORG_ID,
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 64,
          messages: [{ role: "user", content: "Hello" }],
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).toContain("No provider is configured");
  });
});
