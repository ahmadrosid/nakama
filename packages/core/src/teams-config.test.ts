import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { withPairingConfigLock } from "./channel-config-shared";
import { asTestFetch, withTempHome } from "./channel-test-helpers";
import {
  getTeamsConfigDir,
  getTeamsConfigPath,
  isTeamsUserAuthorized,
  loadTeamsConfigFile,
  loadTeamsSettingsPublic,
  regenerateTeamsHandshake,
  saveTeamsConfig,
  saveTeamsInboundPort,
  verifyAndPairTeamsUser,
} from "./teams-config";

const owner = { orgId: "org_a", profileId: "agent_a" };

const tenantId = "11111111-1111-4111-8111-111111111111";

const clientId = "22222222-2222-4222-8222-222222222222";

const userId = "33333333-3333-4333-8333-333333333333";

const secret = "teams-fixture-secret";

const input = { clientId, clientSecret: secret, tenantId };

const originalFetch = globalThis.fetch;

const originalPublicUrl = process.env.NAKAMA_WEB_PUBLIC_URL;

beforeEach(() => {
  globalThis.fetch = asTestFetch(async (url, options) => {
    expect(String(url)).toBe(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
    );
    const body = new URLSearchParams(String(options?.body));
    expect(body.get("client_id")).toBe(clientId);
    expect(body.get("client_secret")).toBe(secret);
    expect(body.get("scope")).toBe("https://api.botframework.com/.default");

    return Response.json({
      access_token: "fixture-app-token",
      token_type: "Bearer",
    });
  });
  process.env.NAKAMA_WEB_PUBLIC_URL = "https://nakama.example/base/";
});

test("old Teams configs load without pairing state", async () => {
  await withTempHome("teams-config-", async () => {
    await saveTeamsConfig(input, owner);
    const path = getTeamsConfigPath(owner);
    const raw = await readFile(path, "utf8");
    await writeFile(
      path,
      raw.replace(
        /^(paired_user_ids|handshake_code|handshake_expires_at)\s*=.*\n/gm,
        ""
      )
    );
    expect(await loadTeamsConfigFile(owner)).toMatchObject({
      handshakeCode: null,
      handshakeExpiresAt: null,
      pairedUserIds: [],
    });
  });
});

test("a generated code links an Entra user once and survives later config writes", async () => {
  await withTempHome("teams-config-", async () => {
    await saveTeamsConfig(input, owner);
    const generated = await regenerateTeamsHandshake(owner);
    expect(generated.handshakeCode).toMatch(/^[0-9A-F]{32}$/);
    expect(Date.parse(generated.handshakeExpiresAt ?? "")).toBeGreaterThan(
      Date.now()
    );
    const code = generated.handshakeCode!;
    expect(
      (
        await verifyAndPairTeamsUser(
          code
            .toLowerCase()
            .match(/.{1,4}/g)!
            .join("-"),
          userId.toUpperCase(),
          tenantId.toUpperCase(),
          owner
        )
      ).ok
    ).toBe(true);
    expect(await loadTeamsSettingsPublic(owner)).toMatchObject({
      handshakeCode: null,
      handshakeExpiresAt: null,
      pairedUserIds: [userId],
    });
    await saveTeamsConfig({ allowedUserIds: clientId }, owner);
    await saveTeamsInboundPort(4321, owner);
    const reloaded = await loadTeamsConfigFile(owner);
    expect(reloaded).toMatchObject({
      allowedUserIds: [clientId],
      inboundPort: 4321,
      pairedUserIds: [userId],
    });
    expect(isTeamsUserAuthorized(userId, reloaded!)).toBe(true);
    expect(isTeamsUserAuthorized(clientId, reloaded!)).toBe(true);
    expect(
      (
        await verifyAndPairTeamsUser(
          code,
          "44444444-4444-4444-8444-444444444444",
          tenantId,
          owner
        )
      ).ok
    ).toBe(false);
  });
});

test("wrong tenant, invalid sender, and another owner cannot consume a code", async () => {
  await withTempHome("teams-config-", async () => {
    await saveTeamsConfig(input, owner);
    const { handshakeCode } = await regenerateTeamsHandshake(owner);

    for (const [sender, tenant, scope] of [
      [userId, clientId, owner],
      ["not-a-guid", tenantId, owner],
      [userId, tenantId, { ...owner, orgId: "org_b" }],
      [userId, tenantId, { ...owner, profileId: "agent_b" }],
    ] as const) {
      expect(
        (await verifyAndPairTeamsUser(handshakeCode!, sender, tenant, scope)).ok
      ).toBe(false);
    }

    expect((await loadTeamsSettingsPublic(owner)).handshakeCode).toBe(
      handshakeCode
    );
    expect((await loadTeamsConfigFile(owner))?.pairedUserIds).toEqual([]);
  });
});

test("expired codes are hidden and cannot pair", async () => {
  await withTempHome("teams-config-", async () => {
    await saveTeamsConfig(input, owner);

    const { handshakeCode, handshakeExpiresAt } =
      await regenerateTeamsHandshake(owner);

    const path = getTeamsConfigPath(owner);
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace(
        handshakeExpiresAt!,
        "2000-01-01T00:00:00.000Z"
      )
    );
    expect(await loadTeamsSettingsPublic(owner)).toMatchObject({
      handshakeCode: null,
      handshakeExpiresAt: null,
    });
    expect(
      (await verifyAndPairTeamsUser(handshakeCode!, userId, tenantId, owner)).ok
    ).toBe(false);
    expect((await loadTeamsConfigFile(owner))?.pairedUserIds).toEqual([]);
  });
});

test("five failed attempts retire a code and regeneration replaces it", async () => {
  await withTempHome("teams-config-", async () => {
    await saveTeamsConfig(input, owner);
    const first = await regenerateTeamsHandshake(owner);

    const wrong =
      first.handshakeCode === "0".repeat(32) ? "1".repeat(32) : "0".repeat(32);

    for (let i = 0; i < 5; i += 1) {
      expect(
        (await verifyAndPairTeamsUser(wrong, userId, tenantId, owner)).ok
      ).toBe(false);
    }

    expect((await loadTeamsSettingsPublic(owner)).handshakeCode).toBeNull();
    expect(
      (
        await verifyAndPairTeamsUser(
          first.handshakeCode!,
          userId,
          tenantId,
          owner
        )
      ).ok
    ).toBe(false);
    const second = await regenerateTeamsHandshake(owner);
    expect(second.handshakeCode).not.toBe(first.handshakeCode);
    expect(
      (
        await verifyAndPairTeamsUser(
          first.handshakeCode!,
          userId,
          tenantId,
          owner
        )
      ).ok
    ).toBe(false);
    expect(
      (
        await verifyAndPairTeamsUser(
          second.handshakeCode!,
          userId,
          tenantId,
          owner
        )
      ).ok
    ).toBe(true);
  });
});

test("two users cannot consume the same code", async () => {
  await withTempHome("teams-config-", async () => {
    await saveTeamsConfig(input, owner);
    const { handshakeCode } = await regenerateTeamsHandshake(owner);

    const results = await Promise.all(
      [userId, clientId].map((id) =>
        verifyAndPairTeamsUser(handshakeCode!, id, tenantId, owner)
      )
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect((await loadTeamsConfigFile(owner))?.pairedUserIds).toHaveLength(1);
  });
});

test("pairing, allowlist edits, regeneration, and port writes preserve each other", async () => {
  await withTempHome("teams-config-", async () => {
    await saveTeamsConfig(input, owner);
    const { handshakeCode } = await regenerateTeamsHandshake(owner);
    await Promise.all([
      verifyAndPairTeamsUser(handshakeCode!, userId, tenantId, owner),
      saveTeamsConfig({ allowedUserIds: clientId }, owner),
      saveTeamsInboundPort(4321, owner),
    ]);
    expect(await loadTeamsConfigFile(owner)).toMatchObject({
      allowedUserIds: [clientId],
      handshakeCode: null,
      inboundPort: 4321,
      pairedUserIds: [userId],
    });
    await Promise.all([
      regenerateTeamsHandshake(owner),
      saveTeamsInboundPort(null, owner),
    ]);
    expect(await loadTeamsConfigFile(owner)).toMatchObject({
      inboundPort: null,
      pairedUserIds: [userId],
    });
    expect((await loadTeamsSettingsPublic(owner)).handshakeCode).not.toBeNull();
  });
});

test("Teams config writers wait for the cross-process pairing lock", async () => {
  await withTempHome("teams-config-", async () => {
    await saveTeamsConfig(input, owner);
    let write: Promise<number>;
    await withPairingConfigLock(getTeamsConfigDir(owner), async () => {
      const child = Bun.spawn(
        [
          process.execPath,
          "--no-install",
          "--eval",
          `import { saveTeamsInboundPort } from ${JSON.stringify(import.meta.resolve("./teams-config"))};
         console.log("ready");
         await saveTeamsInboundPort(4321, ${JSON.stringify(owner)});`,
        ],
        { env: { ...process.env }, stderr: "inherit", stdout: "pipe" }
      );

      write = child.exited;
      const reader = child.stdout.getReader();
      const ready = await reader.read();
      reader.releaseLock();
      expect(new TextDecoder().decode(ready.value).trim()).toBe("ready");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await loadTeamsConfigFile(owner))?.inboundPort).toBeNull();
    });
    expect(await write!).toBe(0);
    expect((await loadTeamsConfigFile(owner))?.inboundPort).toBe(4321);
  });
});

test("a secret rotation preserves links but a bot or tenant change clears them", async () => {
  await withTempHome("teams-config-", async () => {
    await saveTeamsConfig(input, owner);
    const first = await regenerateTeamsHandshake(owner);
    await verifyAndPairTeamsUser(first.handshakeCode!, userId, tenantId, owner);
    const pending = await regenerateTeamsHandshake(owner);
    globalThis.fetch = asTestFetch(async () =>
      Response.json({ access_token: "fixture", token_type: "Bearer" })
    );
    await saveTeamsConfig({ clientSecret: "new-secret" }, owner);
    expect(await loadTeamsConfigFile(owner)).toMatchObject({
      handshakeCode: pending.handshakeCode,
      pairedUserIds: [userId],
    });
    await saveTeamsConfig({ clientId: userId }, owner);
    expect(await loadTeamsConfigFile(owner)).toMatchObject({
      handshakeCode: null,
      handshakeExpiresAt: null,
      pairedUserIds: [],
    });
    const next = await regenerateTeamsHandshake(owner);
    await verifyAndPairTeamsUser(next.handshakeCode!, userId, tenantId, owner);
    await saveTeamsConfig({ tenantId: clientId }, owner);
    expect(await loadTeamsConfigFile(owner)).toMatchObject({
      handshakeCode: null,
      pairedUserIds: [],
    });
  });
});

test("generation requires a saved connection", async () => {
  await withTempHome("teams-config-", async () => {
    await expect(regenerateTeamsHandshake(owner)).rejects.toThrow();
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;

  if (originalPublicUrl === undefined) {
    delete process.env.NAKAMA_WEB_PUBLIC_URL;
  } else {
    process.env.NAKAMA_WEB_PUBLIC_URL = originalPublicUrl;
  }
});

test("saves private owner-scoped credentials and exposes no secret", async () => {
  await withTempHome("teams-config-", async () => {
    const saved = await saveTeamsConfig(
      { ...input, allowedUserIds: `${userId},${userId.toUpperCase()}` },
      owner
    );

    expect(saved.configured).toBe(true);
    expect(saved.allowedUserIds).toEqual([userId]);
    expect(saved.clientSecretConfigured).toBe(true);
    expect(saved.messagingEndpoint).toBe(
      "https://nakama.example/base/v1/channels/teams/agent_a/messages"
    );
    expect(JSON.stringify(saved)).not.toContain(secret);
    expect(await loadTeamsConfigFile(owner)).toMatchObject({
      ...input,
      allowedUserIds: [userId],
      inboundPort: null,
      profileId: "agent_a",
    });
    expect(await loadTeamsConfigFile({ ...owner, orgId: "org_b" })).toBeNull();

    if (process.platform !== "win32") {
      expect((await stat(getTeamsConfigPath(owner))).mode % 0o1000).toBe(0o600);
    }
  });
});

test("rejected credentials keep the previous connection and do not expose upstream errors", async () => {
  await withTempHome("teams-config-", async () => {
    await saveTeamsConfig(input, owner);
    const before = await readFile(getTeamsConfigPath(owner), "utf8");
    globalThis.fetch = asTestFetch(async () =>
      Response.json({ error_description: secret }, { status: 401 })
    );
    let failure: unknown;

    try {
      await saveTeamsConfig({ clientSecret: "rejected-secret" }, owner);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain(secret);
    expect(String(failure)).not.toContain("rejected-secret");
    expect(await readFile(getTeamsConfigPath(owner), "utf8")).toBe(before);
  });
});

test("allowlist updates preserve an omitted secret and an empty list denies everyone", async () => {
  await withTempHome("teams-config-", async () => {
    await saveTeamsConfig(input, owner);
    await saveTeamsConfig({ allowedUserIds: userId }, owner);
    await saveTeamsConfig({ allowedUserIds: "" }, owner);
    expect(await loadTeamsConfigFile(owner)).toMatchObject({
      allowedUserIds: [],
      clientSecret: secret,
    });
    await expect(
      saveTeamsConfig({ allowedUserIds: "not-a-user-id" }, owner)
    ).rejects.toThrow();
    await expect(
      saveTeamsConfig({ profileId: "other" }, owner)
    ).rejects.toThrow();
  });
});

test("the same Teams bot cannot be claimed by another agent", async () => {
  await withTempHome("teams-config-", async () => {
    await saveTeamsConfig(input, owner);
    await expect(
      saveTeamsConfig(input, { orgId: "org_b", profileId: "agent_b" })
    ).rejects.toThrow();
    expect(
      await loadTeamsConfigFile({ orgId: "org_b", profileId: "agent_b" })
    ).toBeNull();
  });
});

test("runtime ports are validated and cleared without changing credentials", async () => {
  await withTempHome("teams-config-", async () => {
    await saveTeamsConfig(input, owner);
    await saveTeamsInboundPort(43_120, owner);
    expect((await loadTeamsConfigFile(owner))?.inboundPort).toBe(43_120);
    await expect(saveTeamsInboundPort(0, owner)).rejects.toThrow();
    await expect(saveTeamsInboundPort(65_536, owner)).rejects.toThrow();
    await saveTeamsInboundPort(null, owner);
    expect(await loadTeamsConfigFile(owner)).toMatchObject({
      clientSecret: secret,
      inboundPort: null,
    });
  });
});

test.each([
  undefined,
  "http://public.example",
  "https://user:password@example.com",
  "not-a-url",
])("does not advertise an unusable public URL: %s", async (publicUrl) => {
  await withTempHome("teams-config-", async () => {
    if (publicUrl === undefined) {
      delete process.env.NAKAMA_WEB_PUBLIC_URL;
    } else {
      process.env.NAKAMA_WEB_PUBLIC_URL = publicUrl;
    }

    expect((await loadTeamsSettingsPublic(owner)).messagingEndpoint).toBeNull();
  });
});
