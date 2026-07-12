import { describe, expect, test } from "bun:test";
import type { HealthResponse, ModelsResponse, ProfileSummary } from "@nakama/core";
import {
  formatErrorLines,
  formatStatusLines,
  isEscInterruptKey,
  needsTrailingStreamNewline,
} from "./chat";

describe("needsTrailingStreamNewline", () => {
  test("adds a newline when no chunk was rendered", () => {
    expect(needsTrailingStreamNewline(null)).toBe(true);
  });

  test("adds a newline when the stream ended mid-line", () => {
    expect(needsTrailingStreamNewline("Hello.")).toBe(true);
  });

  test("skips the newline when the stream already ended with one", () => {
    expect(needsTrailingStreamNewline("Hello.\n")).toBe(false);
    expect(needsTrailingStreamNewline("Hello.\r\n")).toBe(false);
  });
});

describe("formatStatusLines", () => {
  const health: HealthResponse = {
    ok: true,
    apiVersion: 1,
    providerConfigured: true,
    userConfigured: true,
    composioConfigured: false,
    composioAvailable: false,
  };
  const models: ModelsResponse = {
    currentProviderId: "provider-a",
    providers: [],
    models: [],
    provider: "anthropic",
    displayName: null,
  };
  const profile: ProfileSummary = {
    id: "default",
    name: "Default",
    model: "provider-a::claude-sonnet",
    isSuper: false,
    toolCount: 0,
    mcpServerCount: 0,
    soulActive: false,
    hasAvatar: false,
    createdAt: "",
    updatedAt: "",
  };

  test("matches the telegram status summary fields", () => {
    expect(formatStatusLines(health, models, profile)).toEqual([
      "Server: ok",
      "Provider configured: yes",
      "Profile: Default",
      "Provider: anthropic",
      "Model: claude-sonnet",
    ]);
  });

  test("shows offline mode when no provider is configured", () => {
    expect(
      formatStatusLines({ ...health, providerConfigured: false }, null, profile),
    ).toEqual([
      "Server: ok",
      "Provider configured: no",
      "Chat runs in offline mode without an API key.",
    ]);
  });
});

describe("formatErrorLines", () => {
  test("adds a blank line above rendered errors", () => {
    expect(formatErrorLines(new Error("Boom"))).toEqual(["", "Boom"]);
  });

  test("splits multiline errors into separate render lines", () => {
    expect(formatErrorLines(new Error("DeepSeek request failed\ninternal_error"))).toEqual([
      "",
      "DeepSeek request failed",
      "internal_error",
    ]);
  });
});

describe("isEscInterruptKey", () => {
  test("matches only a standalone escape key", () => {
    expect(isEscInterruptKey("\u001b")).toBe(true);
    expect(isEscInterruptKey("\u001b[A")).toBe(false);
  });
});
