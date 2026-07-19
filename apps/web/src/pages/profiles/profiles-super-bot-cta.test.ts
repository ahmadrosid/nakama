import { describe, expect, test } from "bun:test";
import type { ProfileSummary } from "@nakama/core/contract";
import { resolveSuperBotChatProfileId } from "@/lib/profiles";

function profile(
  partial: Pick<ProfileSummary, "id" | "name" | "isSuper" | "isDefault">,
): ProfileSummary {
  return {
    id: partial.id,
    name: partial.name,
    isSuper: partial.isSuper,
    isDefault: partial.isDefault,
    model: null,
    hasAvatar: false,
    soulActive: false,
    toolCount: 0,
    mcpServerCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("resolveSuperBotChatProfileId", () => {
  test("returns the super bot profile id when present", () => {
    expect(
      resolveSuperBotChatProfileId([
        profile({ id: "default", name: "Default", isSuper: false, isDefault: true }),
        profile({ id: "super_bot", name: "Super Bot", isSuper: true, isDefault: false }),
      ]),
    ).toBe("super_bot");
  });

  test("returns null when no super bot exists", () => {
    expect(
      resolveSuperBotChatProfileId([
        profile({ id: "default", name: "Default", isSuper: false, isDefault: true }),
      ]),
    ).toBeNull();
  });

  test("returns null for an empty profile list", () => {
    expect(resolveSuperBotChatProfileId([])).toBeNull();
  });
});
