import { describe, expect, test } from "bun:test";
import type { ProfileSummary } from "@nakama/core/contract";
import { resolveSuperBotChatProfileId } from "@/lib/profiles";

function profile(
  partial: Pick<ProfileSummary, "id" | "name" | "isSuper" | "isDefault">
): ProfileSummary {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    hasAvatar: false,
    id: partial.id,
    isDefault: partial.isDefault,
    isSuper: partial.isSuper,
    mcpServerCount: 0,
    model: null,
    name: partial.name,
    soulActive: false,
    toolCount: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("resolveSuperBotChatProfileId", () => {
  test("returns the super bot profile id when present", () => {
    expect(
      resolveSuperBotChatProfileId([
        profile({
          id: "default",
          isDefault: true,
          isSuper: false,
          name: "Default",
        }),
        profile({
          id: "super_bot",
          isDefault: false,
          isSuper: true,
          name: "Super Bot",
        }),
      ])
    ).toBe("super_bot");
  });

  test("returns null when no super bot exists", () => {
    expect(
      resolveSuperBotChatProfileId([
        profile({
          id: "default",
          isDefault: true,
          isSuper: false,
          name: "Default",
        }),
      ])
    ).toBeNull();
  });
});
