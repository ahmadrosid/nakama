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
});
