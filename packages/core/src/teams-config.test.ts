import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { asTestFetch, withTempHome } from "./channel-test-helpers";
import {
  getTeamsConfigPath,
  loadTeamsConfigFile,
  loadTeamsSettingsPublic,
  saveTeamsConfig,
  saveTeamsInboundPort,
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
