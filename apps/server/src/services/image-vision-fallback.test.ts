import { describe, expect, test } from "bun:test";
import type { UserConfig } from "@nakama/core";
import {
  resolvePrimaryModelVisionSupport,
  resolveVisionProviderSelection,
} from "./image-vision-fallback";

describe("resolveVisionProviderSelection", () => {
  test("returns null when vision model is not configured", () => {
    expect(
      resolveVisionProviderSelection({ defaultProviderId: null, providers: [] })
    ).toBeNull();
  });

  test("resolves configured vision-capable model", () => {
    const config: UserConfig = {
      defaultProviderId: "p-openai",
      providers: [
        {
          apiKey: "key",
          createdAt: "2026-01-01T00:00:00.000Z",
          id: "p-gemini",
          label: "Gemini",
          type: "gemini",
        },
      ],
      visionModel: "p-gemini::gemini-2.5-flash",
    };

    const resolved = resolveVisionProviderSelection(config);
    expect(resolved?.model).toBe("gemini-2.5-flash");
    expect(resolved?.instance.id).toBe("p-gemini");
  });

  test("rejects non-vision custom model", () => {
    const config: UserConfig = {
      defaultProviderId: "p-custom",
      providers: [
        {
          apiKey: "key",
          createdAt: "2026-01-01T00:00:00.000Z",
          customModels: [{ id: "text-only", supportsVision: false }],
          id: "p-custom",
          label: "Custom",
          type: "openai_compatible",
        },
      ],
      visionModel: "p-custom::text-only",
    };

    expect(() => resolveVisionProviderSelection(config)).toThrow(
      'Configured image parsing model "text-only" does not support vision.'
    );
  });
});

describe("resolvePrimaryModelVisionSupport", () => {
  test("returns false for opencode go profile model", () => {
    const config: UserConfig = {
      defaultProviderId: "p-go",
      providers: [
        {
          apiKey: "key",
          createdAt: "2026-01-01T00:00:00.000Z",
          id: "p-go",
          label: "OpenCode Go",
          type: "opencode_go",
        },
      ],
    };

    expect(
      resolvePrimaryModelVisionSupport(
        config,
        "p-go::opencode-go/kimi-k2.7-code"
      )
    ).toBe(false);
  });
});
