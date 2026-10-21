import { describe, expect, test } from "bun:test";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";

setupTestConfigDir("nakama-agent-group-routes-");

describe("agent group routes", () => {
  test("/openapi.json documents them with their path params", async () => {
    const { app } = createMinimalHonoApp();

    const spec: ReturnType<typeof app.getOpenAPI31Document> = await (
      await app.fetch(new Request("http://localhost/openapi.json"))
    ).json();

    const session =
      spec.paths?.["/v1/agent-groups/{groupId}/sessions/{sessionId}"];

    expect(spec.paths?.["/v1/agent-groups"]?.post).toBeDefined();
    expect(session?.patch?.requestBody).toBeDefined();
    expect(session?.get?.parameters).toMatchObject([
      { in: "path", name: "groupId" },
      { in: "path", name: "sessionId" },
    ]);
    expect(
      spec.paths?.["/v1/agent-groups/{groupId}/sessions/{sessionId}/stop"]?.post
    ).toBeDefined();
    expect(spec.paths?.["/v1/rail-pins/{itemId}"]?.put).toBeDefined();
    expect(
      spec.paths?.["/v1/agent-groups/{groupId}/memory"]?.put?.requestBody
    ).toBeDefined();
  });
});
