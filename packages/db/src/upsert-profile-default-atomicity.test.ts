import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDatabase } from "./adapters/sqlite";
import type { StoredProfileRecord } from "./types";

function profile(
  id: string,
  orgId: string,
  isDefault: boolean,
  now: string
): StoredProfileRecord {
  return {
    createdAt: now,
    id,
    isDefault,
    isSuper: false,
    model: null,
    name: id,
    orgId,
    systemPrompt: "",
    updatedAt: now,
  };
}

describe("upsertProfile default atomicity", () => {
  let rootDir = "";

  afterEach(async () => {
    if (rootDir) {
      await rm(rootDir, { force: true, recursive: true });
      rootDir = "";
    }
  });

  test("sqlite keeps the prior default when clear-then-upsert rolls back", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "nakama-upsert-default-"));
    const databasePath = join(rootDir, "nakama.sqlite");
    const databaseUrl = `file:${databasePath}`;
    const now = "2020-01-01T00:00:00.000Z";

    const database = await createSqliteDatabase(databaseUrl);
    try {
      await database.adapter.upsertOrganization({
        createdAt: now,
        id: "org_test",
        name: "Test",
        slug: "test",
        updatedAt: now,
      });
      await database.adapter.upsertProfile(
        profile("profile_a", "org_test", true, now)
      );
      await database.adapter.upsertProfile(
        profile("profile_b", "org_test", false, now)
      );
    } finally {
      database.close();
    }

    const raw = new Database(databasePath);
    raw.exec(`
      CREATE TRIGGER fail_default_upsert_profile_b
      BEFORE UPDATE OF is_default ON profiles
      WHEN NEW.id = 'profile_b' AND NEW.is_default = 1
      BEGIN
        SELECT RAISE(ABORT, 'forced default upsert failure');
      END;
    `);
    raw.close();

    const databaseWithTrigger = await createSqliteDatabase(databaseUrl);
    try {
      await expect(
        databaseWithTrigger.adapter.upsertProfile(
          profile("profile_b", "org_test", true, now)
        )
      ).rejects.toThrow();

      const defaults = (
        await databaseWithTrigger.adapter.listProfilesForOrg("org_test")
      ).filter((row) => row.isDefault);
      expect(defaults.map((row) => row.id)).toEqual(["profile_a"]);
    } finally {
      databaseWithTrigger.close();
    }
  });

  test("sqlite concurrent default upserts leave exactly one default", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "nakama-upsert-default-race-"));
    const databasePath = join(rootDir, "nakama.sqlite");
    const databaseUrl = `file:${databasePath}`;
    const now = "2020-01-01T00:00:00.000Z";

    const seed = await createSqliteDatabase(databaseUrl);
    try {
      await seed.adapter.upsertOrganization({
        createdAt: now,
        id: "org_test",
        name: "Test",
        slug: "test",
        updatedAt: now,
      });
      await seed.adapter.upsertProfile(
        profile("profile_a", "org_test", false, now)
      );
      await seed.adapter.upsertProfile(
        profile("profile_b", "org_test", false, now)
      );
    } finally {
      seed.close();
    }

    const left = await createSqliteDatabase(databaseUrl);
    const right = await createSqliteDatabase(databaseUrl);
    try {
      await Promise.all([
        left.adapter.upsertProfile(profile("profile_a", "org_test", true, now)),
        right.adapter.upsertProfile(
          profile("profile_b", "org_test", true, now)
        ),
      ]);

      const defaults = (
        await left.adapter.listProfilesForOrg("org_test")
      ).filter((row) => row.isDefault);
      expect(defaults).toHaveLength(1);
      expect(["profile_a", "profile_b"]).toContain(defaults[0]!.id);
    } finally {
      left.close();
      right.close();
    }
  });
});
