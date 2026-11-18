import { Database } from "bun:sqlite";
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { setupTestConfigDir } from "../../test-config-dir";
import { base, cleanups, setup } from "./google-meet-extension-setup";

setupTestConfigDir("nakama-meet-extension-test-");

afterEach(async () => {
  setSystemTime();

  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

describe("Meet extension pairing", () => {
  test("pairs once with a code and returns the key exactly once", async () => {
    const { action, admin, poll, root, startPairing, status } = await setup();
    const { code, expiresIn, pairId } = await startPairing();

    expect(code).toMatch(/^[2-9A-Z]{3}-[2-9A-Z]{3}$/);
    expect(expiresIn).toBe(300);
    expect(await (await poll(pairId)).json()).toEqual({ status: "pending" });

    const approved = await action(admin, "approve-extension", {
      code: code.toLowerCase().replace("-", ""),
    });

    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ label: "Chrome on macOS" });

    // The code works once.
    expect((await action(admin, "approve-extension", { code })).status).toBe(
      400
    );

    const collected = z
      .object({ key: z.string(), status: z.literal("approved") })
      .parse(await (await poll(pairId)).json());

    expect((await poll(pairId)).status).toBe(404);

    const response = await status(collected.key);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ captureProtocol: 3 });

    const keys = await (await action(admin, "extension-keys")).json();
    expect(keys.keys).toHaveLength(1);
    expect(Object.keys(keys.keys[0]).sort()).toEqual([
      "createdAt",
      "expiresAt",
      "id",
      "label",
      "lastUsedAt",
    ]);

    // Only the hash is stored.
    const path = join(root, "orgs", admin.orgId, "meet", "meetings.sqlite");
    expect(readFileSync(path).includes(collected.key)).toBe(false);
    const db = new Database(path, { readonly: true });
    const row = db.query("SELECT keyHash FROM extension_keys").get();
    db.close();
    expect(row).toEqual({
      keyHash: createHash("sha256").update(collected.key).digest("hex"),
    });
  });

  test("a code expires after five minutes", async () => {
    const { action, admin, poll, startPairing } = await setup();
    const { code, pairId } = await startPairing();

    setSystemTime(new Date(Date.now() + 5 * 60_000 + 1000));

    expect((await action(admin, "approve-extension", { code })).status).toBe(
      400
    );
    expect((await poll(pairId)).status).toBe(404);
  });

  test("caps pending pairings at 100", async () => {
    const { app, startPairing } = await setup();

    for (let index = 0; index < 100; index++) {
      await startPairing();
    }

    const response = await app.fetch(
      new Request(`${base}/v1/meet/extension/pair`, { method: "POST" })
    );

    expect(response.status).toBe(429);
  });
});

describe("Meet extension keys", () => {
  test("run start, transcript and leave as the key's member", async () => {
    const { app, pair } = await setup();
    const key = await pair();
    const headers = { Authorization: `Bearer ${key}` };

    // No OpenAI key is set, so start fails as a normal Meet error, not 401.
    const start = await app.fetch(
      new Request(`${base}/v1/meet/extension/start`, {
        body: JSON.stringify({ url: "https://meet.google.com/abc-defg-hij" }),
        headers: { ...headers, "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(start.status).toBe(400);

    const transcript = await app.fetch(
      new Request(`${base}/v1/meet/extension/transcript?meetingId=missing`, {
        headers,
      })
    );

    expect(transcript.status).toBe(400);
    expect(await transcript.json()).toEqual({ error: "Meeting not found" });

    const leave = await app.fetch(
      new Request(`${base}/v1/meet/extension/leave`, {
        body: JSON.stringify({ meetingId: "missing" }),
        headers: { ...headers, "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(leave.status).toBe(400);
  });

  test("a revoked key gets 401", async () => {
    const { action, admin, pair, status } = await setup();
    const key = await pair();
    const keys = await (await action(admin, "extension-keys")).json();

    expect(
      await (
        await action(admin, "revoke-extension", { keyId: keys.keys[0].id })
      ).json()
    ).toEqual({ revoked: true });
    expect((await status(key)).status).toBe(401);
  });

  test("a member cannot revoke another member's key", async () => {
    const { action, addMember, admin, pair, status } = await setup();
    const key = await pair();
    const keys = await (await action(admin, "extension-keys")).json();
    const member = await addMember("member@example.com");

    expect(
      await (
        await action(member.session, "revoke-extension", {
          keyId: keys.keys[0].id,
        })
      ).json()
    ).toEqual({ revoked: false });
    expect((await status(key)).status).toBe(200);
  });

  test("disconnect revokes only the key that calls it", async () => {
    const { app, pair, status } = await setup();
    const key = await pair();
    const other = await pair();

    const disconnect = (value: string) =>
      app.fetch(
        new Request(`${base}/v1/meet/extension/disconnect`, {
          headers: { Authorization: `Bearer ${value}` },
          method: "POST",
        })
      );

    const response = await disconnect(key);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
    expect((await status(key)).status).toBe(401);
    expect((await status(other)).status).toBe(200);
    expect((await disconnect(key)).status).toBe(401);
  });

  test("disconnect takes only a Meet key, not a browser session", async () => {
    const { admin, app, pair, status } = await setup();
    const key = await pair();

    const response = await app.fetch(
      new Request(`${base}/v1/meet/extension/disconnect`, {
        headers: admin.headers({ "X-CSRF-Token": admin.csrfToken }),
        method: "POST",
      })
    );

    expect(response.status).toBe(401);
    expect((await status(key)).status).toBe(200);
  });

  test("a browser session gets 410 for start-capture, and OpenAPI lists only the key route", async () => {
    const { action, admin, app } = await setup(() => "test");

    const response = await action(admin, "start-capture", {
      url: "https://meet.google.com/abc-defg-hij",
    });

    expect(response.status).toBe(410);

    const overview = await action(admin, "meetings");
    expect((await overview.json()).meetings).toEqual([]);

    const { paths } = z
      .object({ paths: z.record(z.string(), z.unknown()) })
      .parse(
        await (await app.fetch(new Request(`${base}/openapi.json`))).json()
      );

    expect(paths["/v1/meet/actions/start-capture"]).toBeUndefined();
    expect(paths["/v1/meet/actions/leave"]).toBeDefined();
    expect(paths["/v1/meet/extension/start"]).toBeDefined();
  });

  test("an expired key gets 401, and use renews it", async () => {
    const { pair, status } = await setup();
    const key = await pair();
    const day = 24 * 60 * 60_000;

    setSystemTime(new Date(Date.now() + 89 * day));
    expect((await status(key)).status).toBe(200);

    // Renewed on use: 89 more days still works.
    setSystemTime(new Date(Date.now() + 89 * day));
    expect((await status(key)).status).toBe(200);

    setSystemTime(new Date(Date.now() + 91 * day));
    expect((await status(key)).status).toBe(401);
  });

  test("a removed member's key stays revoked after they rejoin", async () => {
    const { addMember, admin, app, databaseAdapter, pair, status } =
      await setup();

    const member = await addMember("member@example.com");
    const key = await pair(member.session);

    expect((await status(key)).status).toBe(200);

    const removed = await app.fetch(
      new Request(`${base}/v1/orgs/${admin.orgId}/members/${member.userId}`, {
        headers: admin.headers({ "X-CSRF-Token": admin.csrfToken }),
        method: "DELETE",
      })
    );

    expect(removed.status).toBe(204);
    expect((await status(key)).status).toBe(401);

    await databaseAdapter.upsertOrgMember({
      createdAt: new Date().toISOString(),
      orgId: admin.orgId,
      role: "member",
      userId: member.userId,
    });
    expect((await status(key)).status).toBe(401);
  });

  test("a disabled user's key gets 401", async () => {
    const { addMember, databaseAdapter, pair, status } = await setup();
    const member = await addMember("member@example.com");
    const key = await pair(member.session);

    await databaseAdapter.disableUserUnlessLastAdmin(
      member.userId,
      new Date().toISOString()
    );
    expect((await status(key)).status).toBe(401);
  });

  test("a password change revokes the user's keys", async () => {
    const { admin, app, pair, status } = await setup();
    const key = await pair();

    const changed = await app.fetch(
      new Request(`${base}/v1/auth/change-password`, {
        body: JSON.stringify({
          currentPassword: "password123",
          newPassword: "new-password-456",
        }),
        headers: admin.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": admin.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(changed.status).toBe(200);
    expect((await status(key)).status).toBe(401);
  });

  test("turning Meet off makes the key fail", async () => {
    const { action, admin, pair, status } = await setup();
    const key = await pair();

    expect((await action(admin, "configure", { enabled: false })).status).toBe(
      200
    );
    expect((await status(key)).status).toBe(401);
  });

  test("a key for another org gets 401", async () => {
    const { databaseAdapter, googleMeetService, pair, status } = await setup();
    const key = await pair();
    const now = new Date().toISOString();

    await databaseAdapter.upsertOrganization({
      createdAt: now,
      id: "org_other",
      name: "Other",
      slug: "other",
      updatedAt: now,
    });
    await googleMeetService.ensureOrganization("org_other");

    const secret = key.slice(key.indexOf(".") + 1);
    const other = `nmk_${Buffer.from("org_other").toString("base64url")}.${secret}`;

    expect((await status(other)).status).toBe(401);
    expect(
      (await status(`${key.slice(0, -1)}${key.endsWith("A") ? "B" : "A"}`))
        .status
    ).toBe(401);
  });

  test("the key works on no other route, and cookies do not work here", async () => {
    const { admin, app, pair, status } = await setup();
    const key = await pair();
    const bearer = { Authorization: `Bearer ${key}` };

    expect(
      (
        await app.fetch(
          new Request(`${base}/v1/meet/actions/meetings`, {
            body: "{}",
            headers: { ...bearer, "Content-Type": "application/json" },
            method: "POST",
          })
        )
      ).status
    ).toBe(401);
    expect(
      (await app.fetch(new Request(`${base}/v1/profiles`, { headers: bearer })))
        .status
    ).toBe(401);
    expect(
      (
        await app.fetch(
          new Request(`${base}/v1/meet/extension/status`, {
            headers: admin.headers(),
          })
        )
      ).status
    ).toBe(401);
    expect((await status("not-a-key", admin.headers())).status).toBe(401);
  });
});
