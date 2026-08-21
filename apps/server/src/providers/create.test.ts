import { describe, expect, test } from "bun:test";
import type { ProviderInstance } from "@nakama/core";
import { createProviderForInstance } from "./create";

describe("createProviderForInstance routing", () => {
  test("creates an xai client from an xai instance", () => {
    const instance: ProviderInstance = {
      apiKey: "test-key",
      createdAt: new Date().toISOString(),
      customModels: [{ default: true, id: "grok-4" }],
      id: "inst_xai",
      label: "xAI Grok",
      type: "xai",
    };

    const client = createProviderForInstance(instance, "grok-4");

    expect(client).not.toBeNull();
    expect(client?.name).toBe("xai");
  });
});
