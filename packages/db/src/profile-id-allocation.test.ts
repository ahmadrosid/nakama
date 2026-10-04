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
      name: "Owner Bot",
      orgId: "org_a",
      systemPrompt: "owner prompt",
      updatedAt: "2020-01-02T00:00:00.000Z",
    });
  });

  test("concurrent claims of one id leave exactly one owner", async () => {
    const db = createSqliteMemoryAdapter();
    const contenders = Array.from({ length: 12 }, (_unused, index) =>
      profile("contested", index % 2 === 0 ? "org_a" : "org_b", {
        systemPrompt: `prompt-${index}`,
      })
    );
    const claims = await Promise.all(
      contenders.map((record) => db.createProfileIfAbsent(record))
    );

    const winners = claims
      .map((created, index) => (created ? contenders[index] : null))
      .filter((record): record is StoredProfileRecord => record !== null);
    expect(winners).toHaveLength(1);
    expect(await db.getProfile("contested")).toMatchObject({
      name: winners[0]?.name,
      orgId: winners[0]?.orgId,
      systemPrompt: winners[0]?.systemPrompt,
    });
    expect(await db.listProfiles()).toHaveLength(1);
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
