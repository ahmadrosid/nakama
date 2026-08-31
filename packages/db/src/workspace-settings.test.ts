import { describe, expect, test } from "bun:test";
import {
  isCodingAgentProviderPassthroughEnabled,
  mergeWorkspaceSettings,
} from "./workspace-settings";

describe("workspace settings merge", () => {
  test("passthrough defaults on when unset", () => {
    expect(isCodingAgentProviderPassthroughEnabled(null)).toBe(true);
    expect(
      isCodingAgentProviderPassthroughEnabled({
        codingAgentProviderPassthrough: true,
      })
    ).toBe(true);
    expect(
      isCodingAgentProviderPassthroughEnabled({
        codingAgentProviderPassthrough: false,
      })
    ).toBe(false);
  });

  test("merge keeps passthrough when another field is patched", () => {
    const merged = mergeWorkspaceSettings(
      {
        codingAgentHarnesses: [],
        codingAgentProviderPassthrough: false,
        id: "default",
        imageModel: null,
        selectedCodingAgentHarness: null,
        transcriptionModel: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
        visionModel: "vision",
      },
      {
        updatedAt: "2026-01-02T00:00:00.000Z",
        visionModel: "other",
      }
    );

    expect(merged.codingAgentProviderPassthrough).toBe(false);
    expect(merged.visionModel).toBe("other");
  });

  test("merge keeps passthrough when token optimizer is patched", () => {
    const merged = mergeWorkspaceSettings(
      {
        codingAgentHarnesses: [],
        codingAgentProviderPassthrough: false,
        id: "default",
        imageModel: null,
        selectedCodingAgentHarness: null,
        transcriptionModel: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
        visionModel: null,
      },
      {
        tokenOptimizerEnabled: true,
        updatedAt: "2026-01-02T00:00:00.000Z",
      }
    );

    expect(merged.codingAgentProviderPassthrough).toBe(false);
    expect(merged.tokenOptimizerEnabled).toBe(true);
  });

  test("merge can clear nullable fields to null", () => {
    const merged = mergeWorkspaceSettings(
      {
        codingAgentHarnesses: [],
        codingAgentProviderPassthrough: true,
        id: "default",
        imageModel: "openai::gpt-image-2",
        selectedCodingAgentHarness: "coding-harness-codex",
        transcriptionModel: "whisper",
        updatedAt: "2026-01-01T00:00:00.000Z",
        visionModel: "vision",
      },
      {
        imageModel: null,
        selectedCodingAgentHarness: null,
        transcriptionModel: null,
        visionModel: null,
      }
    );

    expect(merged.imageModel).toBeNull();
    expect(merged.selectedCodingAgentHarness).toBeNull();
    expect(merged.transcriptionModel).toBeNull();
    expect(merged.visionModel).toBeNull();
  });

  test("merge output never carries an orgId key", () => {
    const merged = mergeWorkspaceSettings(null, {
      id: "default",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(merged).not.toHaveProperty("orgId");
  });
});
