import { describe, expect, test } from "bun:test";
import type { ModelsResponse, ProfileSummary } from "@nakama/core";
import {
  effectiveModelState,
  formatSlashCommands,
  parseModelCommandArg,
  resolveSuggestions,
  resolveModelSwitchTarget,
} from "./commands";

const profile: ProfileSummary = {
  id: "default",
  name: "Default",
  model: "gpt-4o",
  isSuper: false,
  toolCount: 0,
  mcpServerCount: 0,
  soulActive: false,
  hasAvatar: false,
  createdAt: "",
  updatedAt: "",
};

const modelsCache: ModelsResponse = {
  currentProviderId: "provider-a",
  providers: [
    {
      id: "provider-a",
      type: "anthropic",
      label: "Anthropic",
      hasApiKey: true,
      modelCount: 1,
      createdAt: "",
    },
    {
      id: "provider-b",
      type: "openai",
      label: "OpenAI",
      hasApiKey: true,
      modelCount: 1,
      createdAt: "",
    },
  ],
  models: [
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude Sonnet",
      provider: "anthropic",
      providerId: "provider-a",
    },
    {
      id: "gpt-4o",
      name: "GPT-4o",
      provider: "openai",
      providerId: "provider-b",
    },
    {
      id: "shared-model",
      name: "Shared",
      provider: "anthropic",
      providerId: "provider-a",
    },
    {
      id: "shared-model",
      name: "Shared",
      provider: "openai",
      providerId: "provider-b",
    },
  ],
  provider: "anthropic",
  displayName: null,
};

describe("parseModelCommandArg", () => {
  test("parses provider-qualified model ids", () => {
    expect(parseModelCommandArg("provider-b::gpt-4o")).toEqual({
      providerId: "provider-b",
      modelId: "gpt-4o",
    });
  });

  test("keeps plain model ids intact", () => {
    expect(parseModelCommandArg("anthropic/claude-sonnet-4-6")).toEqual({
      providerId: null,
      modelId: "anthropic/claude-sonnet-4-6",
    });
  });
});

describe("resolveModelSwitchTarget", () => {
  test("uses explicit provider ids", () => {
    expect(resolveModelSwitchTarget(modelsCache, "provider-b::gpt-4o")).toEqual({
      providerId: "provider-b",
      modelId: "gpt-4o",
    });
  });

  test("falls back to the current provider for duplicate ids", () => {
    expect(resolveModelSwitchTarget(modelsCache, "shared-model")).toEqual({
      providerId: "provider-a",
      modelId: "shared-model",
    });
  });

  test("requires provider qualification when ids are ambiguous", () => {
    expect(
      resolveModelSwitchTarget(
        { ...modelsCache, currentProviderId: null },
        "shared-model",
      ),
    ).toBe("ambiguous");
  });
});

describe("effectiveModelState", () => {
  test("prefers profile model overrides", () => {
    expect(effectiveModelState(profile, modelsCache)).toEqual({
      modelId: "gpt-4o",
      providerId: "provider-b",
    });
  });

  test("returns null model when profile has no model", () => {
    expect(
      effectiveModelState({ ...profile, model: null }, modelsCache),
    ).toEqual({
      modelId: null,
      providerId: "provider-a",
    });
  });
});

describe("status command", () => {
  test("is included in help and suggestions", () => {
    expect(formatSlashCommands()).toContain("/status");
    expect(resolveSuggestions({ input: "/sta" })).toContainEqual({
      label: "/status",
      description: "show server and model status",
      insertValue: "/status",
    });
  });
});
