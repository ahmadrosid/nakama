import { describe, expect, test } from "bun:test";
import {
  buildClaudeCodeSpawnEnv,
  buildCodexSpawnEnv,
  getInferenceGatewayBaseUrl,
  mergeCodingAgentSpawnEnv,
  normalizeCodingAgentModel,
} from "./coding-agent-spawn-env";

describe("coding-agent spawn env", () => {
  test("normalizes profile model ids", () => {
    expect(normalizeCodingAgentModel("anthropic:claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(normalizeCodingAgentModel("anthropic/claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  test("returns no env overrides when gateway is disabled", () => {
    expect(buildClaudeCodeSpawnEnv({ model: "claude-opus-4-6" })).toEqual({});
    expect(buildCodexSpawnEnv({ model: "gpt-4.1" })).toEqual({});
  });

  test("builds Claude Code gateway env with tier aliases and cleared API key", () => {
    const env = buildClaudeCodeSpawnEnv({
      model: "anthropic:claude-opus-4-6",
      gatewayBaseUrl: "http://127.0.0.1:4310",
      authToken: "tc_local_test",
      orgId: "org_test",
      profileId: "profile_test",
    });

    expect(env).toEqual({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:4310",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "tc_local_test",
      ANTHROPIC_CUSTOM_HEADERS: "X-Org-Id: org_test\nX-Nakama-Profile-Id: profile_test",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-6",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-opus-4-6",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-opus-4-6",
      CLAUDE_CODE_SUBAGENT_MODEL: "claude-opus-4-6",
      CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
      DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1",
      DISABLE_FEEDBACK_COMMAND: "1",
      CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    });
  });

  test("builds Codex gateway env with cleared OpenAI API key", () => {
    expect(
      buildCodexSpawnEnv({
        model: "openai:gpt-4.1",
        gatewayBaseUrl: "http://127.0.0.1:4310",
      }),
    ).toEqual({
      OPENAI_API_KEY: "",
      OPENAI_BASE_URL: "http://127.0.0.1:4310",
      OPENAI_MODEL: "gpt-4.1",
    });
  });

  test("unsets conflicting API keys when merging spawn env", () => {
    const env = mergeCodingAgentSpawnEnv(
      {
        ANTHROPIC_API_KEY: "sk-live",
        OPENAI_API_KEY: "sk-openai",
        HOME: "/tmp",
      },
      {
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "tc_local_test",
      },
    );

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("tc_local_test");
    expect(env.HOME).toBe("/tmp");
  });

  test("prefers NAKAMA_INFERENCE_GATEWAY_URL when gateway is enabled", () => {
    const previousEnabled = process.env.NAKAMA_INFERENCE_GATEWAY_ENABLED;
    const previousUrl = process.env.NAKAMA_INFERENCE_GATEWAY_URL;

    process.env.NAKAMA_INFERENCE_GATEWAY_ENABLED = "1";
    process.env.NAKAMA_INFERENCE_GATEWAY_URL = "https://nakama.example";

    expect(getInferenceGatewayBaseUrl()).toBe("https://nakama.example");

    if (previousEnabled === undefined) {
      delete process.env.NAKAMA_INFERENCE_GATEWAY_ENABLED;
    } else {
      process.env.NAKAMA_INFERENCE_GATEWAY_ENABLED = previousEnabled;
    }

    if (previousUrl === undefined) {
      delete process.env.NAKAMA_INFERENCE_GATEWAY_URL;
    } else {
      process.env.NAKAMA_INFERENCE_GATEWAY_URL = previousUrl;
    }
  });
});
