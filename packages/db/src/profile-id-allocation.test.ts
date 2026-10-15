import { describe, expect, test } from "bun:test";
import { createSqliteMemoryAdapter } from "./adapters/sqlite";
import type { StoredProfileRecord } from "./types";

const NOW = "2020-01-01T00:00:00.000Z";

function profile(
  id: string,
  orgId: string,
  overrides: Partial<StoredProfileRecord> = {}
): StoredProfileRecord {
  return {
    createdAt: NOW,
    id,
    isSuper: false,
    model: null,
    name: `name-${id}`,
    orgId,
    systemPrompt: `prompt-${id}`,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("profile id allocation", () => {
  test("a taken id is refused without touching the owner's row", async () => {
    const db = createSqliteMemoryAdapter();

    const owner = profile("shared", "org_a", {
      acpAgent: { args: ["--stdio"], command: "agent" },
      acpSettings: { effort: "high", model: "sonnet" },
      name: "Owner Bot",
      systemPrompt: "owner prompt",
      updatedAt: "2020-01-02T00:00:00.000Z",
    });

    expect(await db.createProfileIfAbsent(owner)).toBe(true);

    expect(
      await db.createProfileIfAbsent(
        profile("shared", "org_b", {
          name: "Hijacker Bot",
          systemPrompt: "hijack prompt",
        })
      )
    ).toBe(false);

    expect(await db.getProfile("shared")).toMatchObject({
      acpAgent: owner.acpAgent,
      acpSettings: owner.acpSettings,
      name: "Owner Bot",
      orgId: "org_a",
      systemPrompt: "owner prompt",
      updatedAt: "2020-01-02T00:00:00.000Z",
    });
  });

  test("deleteProfileForOrg only removes the importing org's profile", async () => {
    const db = createSqliteMemoryAdapter();
    await db.createProfileIfAbsent(profile("moved", "org_a"));

    expect(await db.deleteProfileForOrg("moved", "org_b")).toBe(false);
    expect(await db.getProfile("moved")).not.toBeNull();

    expect(await db.deleteProfileForOrg("moved", "org_a")).toBe(true);
    expect(await db.getProfile("moved")).toBeNull();
  });
});
