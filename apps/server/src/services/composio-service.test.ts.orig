import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveComposioConfig } from "@nakama/core";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "./auth-service";
import type { ComposioApiClient } from "./composio-api-client";
import { ComposioService } from "./composio-service";

const TEST_API_KEY = "ck_test";

const USER_ID = "user_admin";

const ORG_ID = "org_1";

function createMockClient(): Pick<
  ComposioApiClient,
  | "createProfileSession"
  | "deleteConnectedAccount"
  | "linkToolkitAccount"
  | "listCatalogToolkits"
  | "listSessionTools"
> {
  return {
    async createProfileSession(
      userId,
      _toolkitSlugs,
      _allowedTools,
      connectedAccounts = {}
    ) {
      expect(userId).toBe("nakama:user:user_admin");
      expect(connectedAccounts).toEqual({});

      return {
        headers: { Authorization: "Bearer test" },
        sessionId: "sess_1",
        url: "https://mcp.composio.dev/sess_1",
      };
    },
    async deleteConnectedAccount() {},
    async linkToolkitAccount(_userId, _toolkitSlug) {
      return {
        connectedAccountId: "ca_1",
        redirectUrl: "https://example.com/oauth",
      };
    },
    async listCatalogToolkits() {
      return [
        {
          description: "Google Mail",
          logoUrl: null,
          name: "Gmail",
          slug: "gmail",
        },
      ];
    },
    async listSessionTools() {
      return [
        {
          description: "Send an email",
          inputSchema: { properties: {}, type: "object" },
          name: "Send Email",
          slug: "GMAIL_SEND_EMAIL",
        },
      ];
    },
  };
}

function injectMockComposioClient(
  service: ComposioService,
  client: Partial<ReturnType<typeof createMockClient>>
): void {
  Object.assign(service, {
    apiClientCache: {
      client: { ...createMockClient(), ...client },
      key: TEST_API_KEY,
    },
  });
}

async function seedOrgWithAdmin(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>
) {
  const now = "2026-01-01T00:00:00.000Z";
  await db.upsertOrganization({
    createdAt: now,
    id: ORG_ID,
    name: "Org",
    slug: "org",
    updatedAt: now,
  });
  await db.createUser({
    createdAt: now,
    email: "admin@example.com",
    id: USER_ID,
    passwordHash: "hash",
    updatedAt: now,
  });
  await db.createUser({
    createdAt: now,
    email: "local-client@nakama.internal",
    id: LOCAL_CLIENT_USER_ID,
    passwordHash: "hash",
    updatedAt: now,
  });
  await db.upsertOrgMember({
    createdAt: now,
    orgId: ORG_ID,
    role: "admin",
    userId: LOCAL_CLIENT_USER_ID,
  });
  await db.upsertOrgMember({
    createdAt: "2026-01-01T00:00:01.000Z",
    orgId: ORG_ID,
    role: "admin",
    userId: USER_ID,
  });
}

async function createConfiguredService() {
  const configDir = await mkdtemp(join(tmpdir(), "nakama-composio-service-"));
  const previous = process.env.NAKAMA_CONFIG_DIR;
  process.env.NAKAMA_CONFIG_DIR = configDir;
  await saveComposioConfig({ apiKey: TEST_API_KEY });

  const db = createInMemoryDatabaseAdapter();
  const service = new ComposioService(db, new AuthService());
  injectMockComposioClient(service, createMockClient());

  return {
    db,
    restore() {
      if (previous === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previous;
      }
    },
    service,
  };
}

describe("ComposioService", () => {
  test("teams use only their own personal connections and invalidate removed accounts", async () => {
    const { db, service, restore } = await createConfiguredService();

    try {
      const now = "2026-01-01T00:00:00.000Z";
      await seedOrgWithAdmin(db);
      await db.createUser({
        createdAt: now,
        email: "member@example.com",
        id: "user_member",
        passwordHash: "hash",
        updatedAt: now,
      });

      const sessionCalls: Array<{
        userId: string;
        accounts: Record<string, string>;
      }> = [];

      injectMockComposioClient(service, {
        async createProfileSession(userId, _slugs, _actions, accounts = {}) {
          sessionCalls.push({ accounts, userId });

          return {
            sessionId: `session_${sessionCalls.length}`,
            url: `https://mcp.example.com/session_${sessionCalls.length}`,
          };
        },
      });

      for (const orgId of [ORG_ID, "team_a", "team_b"]) {
        if (orgId !== ORG_ID) {
          await db.upsertOrganization({
            createdAt: now,
            id: orgId,
            name: orgId,
            parentOrgId: ORG_ID,
            slug: orgId,
            updatedAt: now,
          });

          for (const userId of [USER_ID, "user_member"]) {
            await db.upsertOrgMember({
              createdAt: now,
              orgId,
              role: userId === USER_ID ? "admin" : "member",
              userId,
            });
          }
        }

        const profileId = `profile_${orgId}`;
        await db.upsertProfile({
          createdAt: now,
          id: profileId,
          isDefault: false,
          isSuper: false,
          model: null,
          name: "Local agent",
          orgId,
          systemPrompt: "",
          updatedAt: now,
        });

        const toolkit = await service.enableToolkit(orgId, {
          toolkitSlug: "gmail",
        });

        await db.replaceProfileComposioToolkits(profileId, [
          {
            allowedActions: ["GMAIL_SEND_EMAIL"],
            profileId,
            toolkitId: toolkit.id,
          },
        ]);
        await db.upsertComposioUserConnection({
          connectedAccountId: `account_${orgId}`,
          createdAt: now,
          id: `connection_${orgId}`,
          lastError: null,
          oauthStateHash: null,
          orgId,
          sessionIdEnc: null,
          status: "connected",
          toolkitId: toolkit.id,
          updatedAt: now,
          userId: USER_ID,
        });
      }

      for (const orgId of [ORG_ID, "team_a", "team_b"]) {
        const profileId = `profile_${orgId}`;

        const assigned = await service.getAssignedToolkitRecords(
          orgId,
          USER_ID,
          profileId
        );

        expect(assigned).toHaveLength(1);
        expect(assigned[0]?.userConnection).toMatchObject({
          connectedAccountId: `account_${orgId}`,
          orgId,
          userId: USER_ID,
        });

        const endpoint = await service.getProfileSessionEndpoint(
          orgId,
          USER_ID,
          profileId
        );

        expect(endpoint).not.toBeNull();
        expect(
          await service.getProfileSessionEndpoint(orgId, USER_ID, profileId)
        ).toEqual(endpoint);
      }

      expect(sessionCalls).toEqual(
        [ORG_ID, "team_a", "team_b"].map((orgId) => ({
          accounts: { gmail: `account_${orgId}` },
          userId: `nakama:user:${USER_ID}`,
        }))
      );

      const missing = await service.getAssignedToolkitRecords(
        "team_a",
        "user_member",
        "profile_team_a"
      );

      expect(missing).toHaveLength(1);
      expect(missing[0]?.userConnection).toBeNull();
      expect(
        await service.getProfileSessionEndpoint(
          "team_a",
          "user_member",
          "profile_team_a"
        )
      ).toBeNull();
      expect(
        await service.getProfileSessionEndpoint(
          "team_a",
          USER_ID,
          `profile_${ORG_ID}`
        )
      ).toBeNull();
      expect(
        await service.getAssignedToolkitRecords(
          "team_a",
          USER_ID,
          "profile_team_b"
        )
      ).toEqual([]);
      await db.deleteComposioUserConnection("connection_team_a");
      expect(
        await service.getProfileSessionEndpoint(
          "team_a",
          USER_ID,
          "profile_team_a"
        )
      ).toBeNull();
      expect(
        await service.getProfileSessionEndpoint(
          "team_b",
          USER_ID,
          "profile_team_b"
        )
      ).not.toBeNull();
      expect(sessionCalls).toHaveLength(3);
      expect(
        (
          await service.getAssignedToolkitRecords(
            ORG_ID,
            USER_ID,
            `profile_${ORG_ID}`
          )
        )[0]?.userConnection?.connectedAccountId
      ).toBe(`account_${ORG_ID}`);
    } finally {
      restore();
    }
  });
  test("shared profiles reject integration assignments and default auto-assignment after revocation", async () => {
    const { db, service, restore } = await createConfiguredService();

    try {
      const now = new Date().toISOString();

      for (const id of ["parent", ORG_ID]) {
        await db.upsertOrganization({
          createdAt: now,
          id,
          name: id,
          parentOrgId: id === ORG_ID ? "parent" : null,
          slug: id,
          updatedAt: now,
        });
      }

      await db.upsertProfile({
        createdAt: now,
        id: "template",
        isDefault: false,
        isSuper: false,
        model: null,
        name: "Template",
        orgId: "parent",
        systemPrompt: "",
        updatedAt: now,
      });

      const publication = await db.publishOrgSharedResource({
        createdAt: now,
        id: "publication",
        orgId: "parent",
        resourceId: "template",
        resourceKind: "agent",
        updatedAt: now,
      });

      const profile = await db.createSharedAgentInstance(
        ORG_ID,
        publication.id,
        "shared",
        now
      );

      // Existing databases can contain a shared profile marked as the default.
      await db.upsertProfile({ ...profile, isDefault: true });

      for (const revoked of [false, true]) {
        if (revoked) {
          await db.deleteOrgSharedResource("parent", publication.id);
        }

        const toolkit = await service.enableToolkit(ORG_ID, {
          toolkitSlug: "gmail",
        });

        expect(await db.listProfileComposioToolkits(profile.id)).toEqual([]);

        for (const assignments of [
          [],
          [{ allowedActions: null, toolkitId: toolkit.id }],
        ]) {
          await expect(
            service.updateProfileAssignments(ORG_ID, profile, { assignments })
          ).rejects.toMatchObject({ status: 403 });
        }

        expect(await db.listProfileComposioToolkits(profile.id)).toEqual([]);
        await service.disableToolkit(ORG_ID, "gmail");
      }

      await expect(
        service.updateProfileAssignments("parent", profile, { assignments: [] })
      ).rejects.toMatchObject({ status: 404 });
      expect(await db.listProfileComposioToolkits("template")).toEqual([]);
      await db.upsertProfile({ ...profile, id: "local", isDefault: true });
      await db.upsertProfile({ ...profile, isDefault: false });
      await service.enableToolkit(ORG_ID, { toolkitSlug: "gmail" });
      expect(await db.listProfileComposioToolkits("local")).toHaveLength(1);
      await service.updateProfileAssignments(
        ORG_ID,
        { ...profile, id: "local" },
        { assignments: [] }
      );
      expect(await db.listProfileComposioToolkits("local")).toEqual([]);
    } finally {
      restore();
    }
  });

  test("enableToolkit creates org-scoped toolkit row", async () => {
    const { service, restore } = await createConfiguredService();

    try {
      const toolkit = await service.enableToolkit(ORG_ID, {
        toolkitSlug: "gmail",
      });

      expect(toolkit.toolkitSlug).toBe("gmail");
      expect(toolkit.status).toBe("enabled");

      const listed = await service.listToolkits(ORG_ID, USER_ID);
      expect(listed.orgToolkits).toHaveLength(1);
      expect(listed.userConnections).toEqual([]);
    } finally {
      restore();
    }
  });

  test("enableToolkit assigns the toolkit to the org default profile", async () => {
    const { db, service, restore } = await createConfiguredService();

    try {
      await db.upsertProfile({
        createdAt: new Date().toISOString(),
        id: "profile_default",
        isDefault: true,
        isSuper: false,
        model: null,
        name: "Default",
        orgId: ORG_ID,
        systemPrompt: "",
        updatedAt: new Date().toISOString(),
      });
      await db.upsertProfile({
        createdAt: new Date().toISOString(),
        id: "profile_super",
        isDefault: false,
        isSuper: true,
        model: null,
        name: "Super Bot",
        orgId: ORG_ID,
        systemPrompt: "",
        updatedAt: new Date().toISOString(),
      });

      const toolkit = await service.enableToolkit(ORG_ID, {
        toolkitSlug: "gmail",
      });

      const assigned = await db.listProfileComposioToolkits("profile_default");
      expect(assigned.map((entry) => entry.toolkitId)).toEqual([toolkit.id]);

      // Super Bot and channel-facing profiles stay an explicit choice.
      expect(await db.listProfileComposioToolkits("profile_super")).toEqual([]);
    } finally {
      restore();
    }
  });

  test("disableToolkit removes the toolkit from every profile in the org", async () => {
    const { db, service, restore } = await createConfiguredService();

    try {
      await db.upsertProfile({
        createdAt: new Date().toISOString(),
        id: "profile_default",
        isDefault: true,
        isSuper: false,
        model: null,
        name: "Default",
        orgId: ORG_ID,
        systemPrompt: "",
        updatedAt: new Date().toISOString(),
      });

      const toolkit = await service.enableToolkit(ORG_ID, {
        toolkitSlug: "gmail",
      });

      expect(
        await db.listProfileComposioToolkits("profile_default")
      ).toHaveLength(1);

      await service.disableToolkit(ORG_ID, "gmail");

      expect(await db.listProfileComposioToolkits("profile_default")).toEqual(
        []
      );
      expect(toolkit.status).toBe("enabled");
    } finally {
      restore();
    }
  });

  test("connectToolkit stores oauth state on user connection and returns redirect URL", async () => {
    const { service, restore } = await createConfiguredService();

    try {
      await service.enableToolkit(ORG_ID, { toolkitSlug: "gmail" });

      const response = await service.connectToolkit(
        ORG_ID,
        USER_ID,
        "gmail",
        "http://localhost:4310"
      );

      expect(response.redirectUrl).toBe("https://example.com/oauth");
      const listed = await service.listToolkits(ORG_ID, USER_ID);
      expect(listed.orgToolkits[0]?.status).toBe("enabled");
      expect(listed.userConnections[0]?.status).toBe("oauth_in_progress");
    } finally {
      restore();
    }
  });

  test("listToolkits surfaces catalogError when catalog fetch fails", async () => {
    const { service, restore } = await createConfiguredService();

    injectMockComposioClient(service, {
      ...createMockClient(),
      async listCatalogToolkits() {
        throw new Error("Failed to fetch toolkits");
      },
    });

    try {
      const listed = await service.listToolkits(ORG_ID, USER_ID);
      expect(listed.configured).toBe(true);
      expect(listed.composioReachable).toBe(false);
      expect(listed.composioAvailable).toBe(false);
      expect(listed.catalogError).toBe("Failed to fetch toolkits");
      expect(listed.catalog).toEqual([]);
      expect(listed.orgToolkits).toEqual([]);
      expect(listed.userConnections).toEqual([]);
    } finally {
      restore();
    }
  });

  test("isReachable probes with limit 1 and caches the result", async () => {
    const { service, restore } = await createConfiguredService();
    let calls = 0;
    let lastLimit: number | undefined;

    injectMockComposioClient(service, {
      ...createMockClient(),
      async listCatalogToolkits(options) {
        calls += 1;
        lastLimit = options?.limit;

        return [
          { description: null, logoUrl: null, name: "Gmail", slug: "gmail" },
        ];
      },
    });

    try {
      expect(await service.isReachable()).toBe(true);
      expect(await service.isReachable()).toBe(true);
      expect(calls).toBe(1);
      expect(lastLimit).toBe(1);

      Object.assign(service, {
        reachabilityCache: { expiresAt: Date.now() - 1, value: true },
      });

      // Stale cache returns immediately and refreshes in the background.
      expect(await service.isReachable()).toBe(true);
      expect(calls).toBe(1);

      // SAFETY: This field is set by isReachable before its deferred refresh.
      const inflight = Object.getOwnPropertyDescriptor(
        service,
        "reachabilityInflight"
      )?.value as Promise<boolean> | null;

      expect(inflight).not.toBeNull();
      await inflight;
      expect(calls).toBe(2);

      service.reloadConfiguration();
      injectMockComposioClient(service, {
        ...createMockClient(),
        async listCatalogToolkits(options) {
          calls += 1;
          lastLimit = options?.limit;

          return [];
        },
      });
      expect(await service.isReachable()).toBe(true);
      expect(calls).toBe(3);
      expect(lastLimit).toBe(1);
    } finally {
      restore();
    }
  });

  test("isReachable coalesces concurrent probes", async () => {
    const { service, restore } = await createConfiguredService();
    let calls = 0;
    let release!: () => void;

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    injectMockComposioClient(service, {
      ...createMockClient(),
      async listCatalogToolkits() {
        calls += 1;
        await gate;

        return [];
      },
    });

    try {
      const pending = Promise.all([
        service.isReachable(),
        service.isReachable(),
        service.isReachable(),
      ]);

      release();
      expect(await pending).toEqual([true, true, true]);
      expect(calls).toBe(1);
    } finally {
      restore();
    }
  });

  test("resolveComposioActingUserId maps local client to earliest human admin", async () => {
    const { db, service, restore } = await createConfiguredService();

    try {
      await seedOrgWithAdmin(db);
      expect(
        await service.resolveComposioActingUserId(ORG_ID, LOCAL_CLIENT_USER_ID)
      ).toBe(USER_ID);
      expect(await service.resolveComposioActingUserId(ORG_ID, USER_ID)).toBe(
        USER_ID
      );
    } finally {
      restore();
    }
  });

  test("getAssignedToolkitRecords uses admin connections for local client sessions", async () => {
    const { db, service, restore } = await createConfiguredService();
    const now = "2026-01-01T00:00:00.000Z";

    try {
      await seedOrgWithAdmin(db);

      const toolkit = await service.enableToolkit(ORG_ID, {
        toolkitSlug: "gmail",
      });

      await db.upsertComposioUserConnection({
        connectedAccountId: "ca_admin",
        createdAt: now,
        id: "cuc_admin",
        lastError: null,
        oauthStateHash: null,
        orgId: ORG_ID,
        sessionIdEnc: null,
        status: "connected",
        toolkitId: toolkit.id,
        updatedAt: now,
        userId: USER_ID,
      });
      await db.upsertProfile({
        createdAt: now,
        id: "profile_1",
        isDefault: true,
        isSuper: false,
        model: null,
        name: "Bot",
        orgId: ORG_ID,
        systemPrompt: "",
        updatedAt: now,
      });
      await db.replaceProfileComposioToolkits("profile_1", [
        { allowedActions: null, profileId: "profile_1", toolkitId: toolkit.id },
      ]);

      const assigned = await service.getAssignedToolkitRecords(
        ORG_ID,
        LOCAL_CLIENT_USER_ID,
        "profile_1"
      );

      expect(assigned).toHaveLength(1);
      expect(assigned[0]?.userConnection?.status).toBe("connected");
      expect(assigned[0]?.userConnection?.userId).toBe(USER_ID);
    } finally {
      restore();
    }
  });

  test("formatProfileConnectionsContext guides search+invoke workflow and tool selection", async () => {
    const { db, service, restore } = await createConfiguredService();
    const now = "2026-01-01T00:00:00.000Z";

    try {
      await seedOrgWithAdmin(db);

      const toolkit = await service.enableToolkit(ORG_ID, {
        toolkitSlug: "gmail",
      });

      await db.upsertComposioUserConnection({
        connectedAccountId: "ca_admin",
        createdAt: now,
        id: "cuc_admin",
        lastError: null,
        oauthStateHash: null,
        orgId: ORG_ID,
        sessionIdEnc: null,
        status: "connected",
        toolkitId: toolkit.id,
        updatedAt: now,
        userId: USER_ID,
      });
      await db.upsertProfile({
        createdAt: now,
        id: "profile_1",
        isDefault: true,
        isSuper: false,
        model: null,
        name: "Bot",
        orgId: ORG_ID,
        systemPrompt: "",
        updatedAt: now,
      });
      await db.replaceProfileComposioToolkits("profile_1", [
        { allowedActions: null, profileId: "profile_1", toolkitId: toolkit.id },
      ]);

      const context = await service.formatProfileConnectionsContext(
        ORG_ID,
        USER_ID,
        "profile_1"
      );

      expect(context).toContain("composio__search_actions");
      expect(context).toContain("composio__invoke_action");
      expect(context).toContain("composio__connect_account");
      // Selection guidance: steer toward web_search for public facts.
      expect(context).toContain("web_search");
      // Per-toolkit connection status line.
      expect(context).toContain("`gmail`");
      expect(context).toContain("connected");
    } finally {
      restore();
    }
  });

  test("formatProfileConnectionsContext omits search/invoke workflow when no toolkit is connected", async () => {
    const { db, service, restore } = await createConfiguredService();
    const now = "2026-01-01T00:00:00.000Z";

    try {
      await seedOrgWithAdmin(db);

      const toolkit = await service.enableToolkit(ORG_ID, {
        toolkitSlug: "gmail",
      });

      await db.upsertProfile({
        createdAt: now,
        id: "profile_unconnected",
        isDefault: false,
        isSuper: false,
        model: null,
        name: "Bot",
        orgId: ORG_ID,
        systemPrompt: "",
        updatedAt: now,
      });
      await db.replaceProfileComposioToolkits("profile_unconnected", [
        {
          allowedActions: null,
          profileId: "profile_unconnected",
          toolkitId: toolkit.id,
        },
      ]);

      const context = await service.formatProfileConnectionsContext(
        ORG_ID,
        USER_ID,
        "profile_unconnected"
      );

      // Assigned toolkit is listed, but no connection exists.
      expect(context).toContain("`gmail`");
      expect(context).toContain("not_connected");
      // The search/invoke workflow is not exposed until a toolkit is connected.
      expect(context).not.toContain("composio__search_actions");
      expect(context).not.toContain("composio__invoke_action");
      // Connect-account guidance is still present.
      expect(context).toContain("composio__connect_account");
    } finally {
      restore();
    }
  });

  test("formatProfileConnectionsContext is empty when no toolkits are assigned", async () => {
    const { db, service, restore } = await createConfiguredService();
    const now = "2026-01-01T00:00:00.000Z";

    try {
      await seedOrgWithAdmin(db);
      await db.upsertProfile({
        createdAt: now,
        id: "profile_empty",
        isDefault: false,
        isSuper: false,
        model: null,
        name: "Bot",
        orgId: ORG_ID,
        systemPrompt: "",
        updatedAt: now,
      });

      const context = await service.formatProfileConnectionsContext(
        ORG_ID,
        USER_ID,
        "profile_empty"
      );

      expect(context).toBe("");
    } finally {
      restore();
    }
  });
});
