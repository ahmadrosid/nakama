import { describe, expect, test } from "bun:test";
import type { ModelsResponse, ProfileSummary } from "@nakama/core";
import {
  effectiveModelState,
  formatSlashCommands,
  parseModelCommandArg,
  resolveModelSwitchTarget,
  resolveSuggestions,
} from "./commands";

const profile: ProfileSummary = {
  createdAt: "",
  hasAvatar: false,
  id: "default",
  isSuper: false,
  mcpServerCount: 0,
  model: "gpt-4o",
  name: "Default",
  soulActive: false,
  toolCount: 0,
  updatedAt: "",
};

const modelsCache: ModelsResponse = {
  currentProviderId: "provider-a",
  displayName: null,
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
  providers: [
    {
      createdAt: "",
      hasApiKey: true,
      id: "provider-a",
      label: "Anthropic",
      modelCount: 1,
      type: "anthropic",
    },
    {
      createdAt: "",
      hasApiKey: true,
      id: "provider-b",
      label: "OpenAI",
      modelCount: 1,
      type: "openai",
    },
  ],
};

describe("parseModelCommandArg", () => {
  test("parses provider-qualified model ids", () => {
    expect(parseModelCommandArg("provider-b::gpt-4o")).toEqual({
      modelId: "gpt-4o",
      providerId: "provider-b",
    });
  });

  test("keeps plain model ids intact", () => {
    expect(parseModelCommandArg("anthropic/claude-sonnet-4-6")).toEqual({
      modelId: "anthropic/claude-sonnet-4-6",
      providerId: null,
    });
  });
});

describe("resolveModelSwitchTarget", () => {
  test("uses explicit provider ids", () => {
    expect(resolveModelSwitchTarget(modelsCache, "provider-b::gpt-4o")).toEqual(
      {
        modelId: "gpt-4o",
        providerId: "provider-b",
      }
    );
  });

  test("falls back to the current provider for duplicate ids", () => {
    expect(resolveModelSwitchTarget(modelsCache, "shared-model")).toEqual({
      modelId: "shared-model",
      providerId: "provider-a",
    });
  });

  test("requires provider qualification when ids are ambiguous", () => {
    expect(
      resolveModelSwitchTarget(
        { ...modelsCache, currentProviderId: null },
        "shared-model"
      )
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
      effectiveModelState({ ...profile, model: null }, modelsCache)
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
      description: "show server and model status",
      insertValue: "/status",
      label: "/status",
    });
  });
});
