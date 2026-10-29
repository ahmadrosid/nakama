import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getCustomToolsDir,
  getProfileSoulDir,
  NakamaApiError,
} from "@nakama/core";
import { AgentService } from "../../services/agent-service";
import { claimLegacyCustomTools } from "../../services/custom-tool-handlers";
import {
  loadToolApiKey,
  loadToolSetup,
  saveToolApiKey,
  saveToolSetup,
  setToolSecrets,
} from "../../services/custom-tool-shared";
import { ManagedSecrets } from "../../services/managed-secrets";
import { ProfileService } from "../../services/profile-service";

import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  createOrgAdminSession,
  loginPlatformAdminSession,
  loginUserSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-tools-route-test-");

function createApp(agentOverrides: Partial<AgentService> = {}) {
  const result = createMinimalHonoApp({
    agent: {
      getTool: async (toolId: string) => ({
        tool: {
          createdAt: new Date().toISOString(),
          description: "Echo tool",
          handlerConfig: { modulePath: "echo.js" },
          handlerType: "javascript",
          id: toolId,
          name: "echo",
          updatedAt: new Date().toISOString(),
        },
      }),
      getToolSource: async () => ({
        content: "export async function run() {}",
        language: "javascript" as const,
        path: "echo.js",
      }),
      listTools: async () => ({ tools: [] }),
      runToolPlayground: async () => ({ ok: true, result: { echo: "hello" } }),
      suggestToolPlaygroundParams: async () => ({
        parameters: { query: "hello" },
      }),
      ...agentOverrides,
    },
  });

  setToolSecrets(
    new ManagedSecrets(
      result.databaseAdapter,
      Buffer.alloc(32, 1).toString("base64")
    )
  );

  return result;
}

describe("tool playground routes", () => {
  test.each(["javascript", "python"])(
    "published parent tool playground and credentials use the active team for %s",
    async (handlerType) => {
      let service: ProfileService;
      let executor: AgentService;

      const {
        app,
        authService,
        databaseAdapter: db,
      } = createApp({
        listTools: (orgId) => service.listTools(orgId),
        getTool: (toolId, orgId) => service.getTool(toolId, orgId),
        getToolSource: (toolId, orgId) => service.getToolSource(toolId, orgId),
        runToolPlayground: (toolId, parameters, context) =>
          executor.runToolPlayground(toolId, parameters, context),
        suggestToolPlaygroundParams: (toolId, prompt, orgId) =>
          executor.suggestToolPlaygroundParams(toolId, prompt, orgId),
        assignTool: (orgId, profileId, request, meta) =>
          service.assignTool(orgId, profileId, request, meta),
        listProfileTools: (orgId, profileId) =>
          service.listProfileTools(orgId, profileId),
        unassignTool: (orgId, profileId, toolId, meta) =>
          service.unassignTool(orgId, profileId, toolId, meta),
      });

      service = new ProfileService(db);
      executor = new AgentService(null, null, db);

      const { orgId: parentOrgId, adminSession } = await createOrgAdminSession(
        app,
        authService,
        db,
        "shared-tools-team",
        "shared-tools-admin@acme.com"
      );

      const now = new Date().toISOString();
      const orgId = "tool_team";
      await db.upsertOrganization({
        id: orgId,
        name: "Team",
        slug: "tool-team",
        parentOrgId,
        createdAt: now,
        updatedAt: now,
      });
      const user = (await db.getUserByEmail("shared-tools-admin@acme.com"))!;
      await db.upsertOrgMember({
        orgId,
        userId: user.id,
        role: "admin",
        createdAt: now,
      });
      await mkdir(getCustomToolsDir(parentOrgId), { recursive: true });
      const profileId = "playground_team";
      await db.upsertProfile({
        id: profileId,
        orgId,
        name: "Playground",
        model: null,
        isSuper: false,
        isDefault: false,
        systemPrompt: "",
        createdAt: now,
        updatedAt: now,
      });
      const workspace = getProfileSoulDir(orgId, profileId);
      await mkdir(workspace, { recursive: true });

      const modulePath = join(
        getCustomToolsDir(parentOrgId),
        handlerType === "python" ? "published-http.py" : "published-http.js"
      );

      await writeFile(
        modulePath,
        handlerType === "python"
          ? 'import os, json, sys\ndef run(input, context):\n    with open("playground.marker", "w") as handle:\n        handle.write("team")\n    return {"keyIsTeam": os.environ.get("NAKAMA_TOOL_API_KEY") == "team-key", "workspace": os.environ.get("NAKAMA_WORKSPACE_ROOT"), "cwd": os.getcwd(), "config": os.environ.get("NAKAMA_CONFIG_DIR")}\nif __name__ == "__main__":\n    print(json.dumps(run(json.loads(sys.stdin.read() or "{}"), {})))\n'
          : 'import {writeFile} from "node:fs/promises"; export async function run(input, context) {await writeFile("playground.marker", "team"); return {keyIsTeam: process.env.NAKAMA_TOOL_API_KEY === "team-key", workspace: context.workspaceRoot, cwd: process.cwd(), config: process.env.NAKAMA_CONFIG_DIR ?? null};}'
      );
      await db.upsertTool({
        id: "published_parent_tool",
        orgId: parentOrgId,
        name: "Published",
        description: "Probe",
        handlerType,
        handlerConfig: { modulePath, requiresApiKey: true },
        createdAt: now,
        updatedAt: now,
      });

      const publication = await db.publishOrgSharedResource({
        id: "tool_publication",
        orgId: parentOrgId,
        resourceKind: "tool",
        resourceId: "published_parent_tool",
        createdAt: now,
        updatedAt: now,
      });

      await saveToolApiKey(parentOrgId, "published_parent_tool", "parent-key");

      const url =
        "http://localhost:4310/v1/tools/published_parent_tool/credentials";

      const status = () =>
        app.fetch(
          new Request(url, { headers: adminSession.headers({}, orgId) })
        );

      const before = await status();

      const headers = adminSession.headers(
        {
          "Content-Type": "application/json",
          "X-CSRF-Token": adminSession.csrfToken,
        },
        orgId
      );

      const run = () =>
        app.fetch(
          new Request(
            "http://localhost:4310/v1/tools/published_parent_tool/run",
            {
              method: "POST",
              headers,
              body: JSON.stringify({ parameters: {} }),
            }
          )
        );

      const missing = await run();
      expect(missing.status).toBe(200);
      expect(await missing.json()).toMatchObject({
        result: { type: "tool_credentials_required", orgId },
      });
      await expect(
        readFile(join(workspace, "playground.marker"))
      ).rejects.toThrow();

      const assigned = await app.fetch(
        new Request(`http://localhost:4310/v1/profiles/${profileId}/tools`, {
          method: "POST",
          headers,
          body: JSON.stringify({ toolId: "published_parent_tool" }),
        })
      );

      expect(assigned.status).toBe(200);

      const listed = await app.fetch(
        new Request(`http://localhost:4310/v1/profiles/${profileId}/tools`, {
          headers,
        })
      );

      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({
        tools: [{ id: "published_parent_tool", scope: "parent" }],
      });
      const detailUrl = "http://localhost:4310/v1/tools/published_parent_tool";

      const detail = await app.fetch(
        new Request(detailUrl, { headers: adminSession.headers({}, orgId) })
      );

      expect(detail.status).toBe(200);
      const payload = await detail.json();
      expect(payload).toMatchObject({
        tool: {
          id: "published_parent_tool",
          scope: "parent",
          publicationId: publication.id,
        },
      });
      expect(JSON.stringify(payload)).not.toContain(modulePath);
      expect(
        (
          await app.fetch(
            new Request(`${detailUrl}/source`, {
              headers: adminSession.headers({}, orgId),
            })
          )
        ).status
      ).toBe(404);
      expect(before.status).toBe(200);
      expect(await before.json()).toMatchObject({
        configured: false,
        source: "missing",
      });

      const saved = await app.fetch(
        new Request(url, {
          method: "PUT",
          headers: adminSession.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": adminSession.csrfToken,
            },
            orgId
          ),
          body: JSON.stringify({ apiKey: "team-key" }),
        })
      );

      expect(saved.status).toBe(200);
      expect(await loadToolApiKey(orgId, "published_parent_tool")).toBe(
        "team-key"
      );
      expect(await loadToolApiKey(parentOrgId, "published_parent_tool")).toBe(
        "parent-key"
      );
      const after = await status();
      expect(await after.json()).toMatchObject({
        configured: true,
        source: "settings",
      });
      const ran = await run();
      expect(ran.status).toBe(200);
      const response = await ran.json();

      expect(response).toMatchObject({
        ok: true,
        result: {
          keyIsTeam: true,
          workspace,
          config: null,
        },
      });
      expect(await realpath(response.result.cwd)).toBe(
        await realpath(workspace)
      );
      expect(await readFile(join(workspace, "playground.marker"), "utf8")).toBe(
        "team"
      );
      await writeFile(join(workspace, "playground.marker"), "unchanged");
      const readPublications = db.listOrgSharedResources.bind(db);
      let reads = 0;

      const revoke = spyOn(db, "listOrgSharedResources").mockImplementation(
        async (id) => {
          if (++reads === 3) {
            await db.deleteOrgSharedResource(parentOrgId, publication.id);
          }

          return readPublications(id);
        }
      );

      try {
        expect((await run()).status).toBe(404);
        expect(reads).toBe(3);
      } finally {
        revoke.mockRestore();
      }

      expect((await run()).status).toBe(404);
      expect(await readFile(join(workspace, "playground.marker"), "utf8")).toBe(
        "unchanged"
      );

      const suggestion = await app.fetch(
        new Request(
          "http://localhost:4310/v1/tools/published_parent_tool/params/suggest",
          { method: "POST", headers, body: JSON.stringify({ prompt: "Probe" }) }
        )
      );

      expect(suggestion.status).toBe(404);

      const removed = await app.fetch(
        new Request(
          `http://localhost:4310/v1/profiles/${profileId}/tools/published_parent_tool`,
          { method: "DELETE", headers }
        )
      );

      expect(removed.status).toBe(200);
      expect(await db.listToolsForProfile(profileId)).toEqual([]);
      expect(
        (
          await app.fetch(
            new Request(detailUrl, { headers: adminSession.headers({}, orgId) })
          )
        ).status
      ).toBe(404);
      expect((await status()).status).toBe(404);

      const denied = await app.fetch(
        new Request(url, {
          method: "PUT",
          headers: adminSession.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": adminSession.csrfToken,
            },
            orgId
          ),
          body: JSON.stringify({ apiKey: "replacement" }),
        })
      );

      expect(denied.status).toBe(404);
      expect(await loadToolApiKey(orgId, "published_parent_tool")).toBe(
        "team-key"
      );
    }
  );
  test("setup approval validates org and target, keeps keys private, and is idempotent", async () => {
    let visibleOrg = "";

    const { app, authService, databaseAdapter } = createApp({
      getProfile: async (orgId: string, profileId: string) => {
        if (orgId !== visibleOrg || profileId !== "target") {
          throw new NakamaApiError("Profile not found.", 404);
        }

        return {
          profile: {
            createdAt: "2026-10-11T00:00:00.000Z",
            hasAvatar: false,
            id: profileId,
            isSuper: false,
            mcpServerCount: 0,
            mcpServers: [],
            model: null,
            name: "Target",
            skills: [],
            soulActive: false,
            systemPrompt: "",
            toolCount: 0,
            tools: [],
            updatedAt: "2026-10-11T00:00:00.000Z",
          },
        };
      },
    });

    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "setup-org",
      "setup-admin@acme.com"
    );

    visibleOrg = orgId;
    const setupId = crypto.randomUUID();
    await saveToolSetup(orgId, {
      id: setupId,
      name: "generic_tool",
      description: "Provider tool",
      plan: "Read provider data",
      requiresApiKey: true,
      sessionId: "session",
      status: "pending",
    });
    const url = `http://localhost:4310/v1/tool-setups/${setupId}`;

    const headers = adminSession.headers(
      {
        "Content-Type": "application/json",
        "X-CSRF-Token": adminSession.csrfToken,
      },
      orgId
    );

    const approve = (body: { apiKey?: string; profileId?: string }) =>
      app.fetch(
        new Request(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })
      );

    expect(
      (await approve({ profileId: "foreign", apiKey: "secret" })).status
    ).toBe(404);
    expect(await loadToolApiKey(orgId, setupId)).toBeUndefined();
    expect((await approve({ profileId: "target" })).status).toBe(400);
    expect(
      (await approve({ profileId: "target", apiKey: "bad\nkey" })).status
    ).toBe(400);

    const approved = await approve({
      profileId: "target",
      apiKey: "private-key",
    });

    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({
      status: "approved",
      profileId: "target",
    });
    expect((await approve({ apiKey: "overwrite" })).status).toBe(200);
    expect(await loadToolApiKey(orgId, setupId)).toBe("private-key");
    expect((await loadToolSetup(orgId, setupId)).profileId).toBe("target");

    const rejected = await app.fetch(
      new Request(url, { headers, method: "DELETE" })
    );

    expect(rejected.status).toBe(200);
    expect((await rejected.json()).status).toBe("rejected");
    expect(await loadToolApiKey(orgId, setupId)).toBeUndefined();
    const status = await app.fetch(new Request(url, { headers }));
    expect(await status.text()).not.toContain("private-key");
    await expect(loadToolSetup("other-org", setupId)).rejects.toThrow();
    expect((await app.fetch(new Request(url))).status).toBe(401);

    const expiresId = crypto.randomUUID();
    await saveToolSetup(orgId, {
      createdAt: "2020-01-01T00:00:00.000Z",
      description: "Expired tool",
      id: expiresId,
      name: "expired_tool",
      plan: "Connect",
      requiresApiKey: true,
      sessionId: "session",
      status: "approved",
    });
    await saveToolApiKey(orgId, expiresId, "staged-key");

    const expired = await app.fetch(
      new Request(`http://localhost:4310/v1/tool-setups/${expiresId}`, {
        headers,
      })
    );

    expect((await expired.json()).status).toBe("rejected");
    expect(await loadToolApiKey(orgId, expiresId)).toBeUndefined();
  });
  test("credential endpoint saves only for an admin's organization and never returns the key", async () => {
    let visibleOrg = "";

    const { app, authService, databaseAdapter } = createApp({
      listTools: async (orgId: string) => ({
        tools:
          orgId === visibleOrg
            ? [
                {
                  createdAt: "2026-10-11T00:00:00.000Z",
                  description: "Key tool",
                  handlerConfig: {},
                  handlerType: "javascript",
                  id: "tool_key",
                  name: "key_tool",
                  updatedAt: "2026-10-11T00:00:00.000Z",
                },
                {
                  createdAt: "2026-10-11T00:00:00.000Z",
                  description: "Environment tool",
                  handlerConfig: {
                    env: [
                      { name: "SERVICE_URL" },
                      { name: "SERVICE_KEY", secret: true },
                    ],
                  },
                  handlerType: "python",
                  id: "tool_env",
                  name: "env_tool",
                  updatedAt: "2026-10-11T00:00:00.000Z",
                },
                {
                  createdAt: "2026-10-11T00:00:00.000Z",
                  description: "Built-in tool",
                  handlerConfig: {},
                  handlerType: "builtin",
                  id: "tool_builtin",
                  name: "builtin_tool",
                  updatedAt: "2026-10-11T00:00:00.000Z",
                },
              ]
            : [],
      }),
    });

    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "credential-org",
      "credential-admin@acme.com"
    );

    visibleOrg = orgId;
    const url = "http://localhost:4310/v1/tools/tool_key/credentials";

    const headers = adminSession.headers(
      {
        "Content-Type": "application/json",
        "X-CSRF-Token": adminSession.csrfToken,
      },
      orgId
    );

    const status = await app.fetch(new Request(url, { headers }));
    expect(await status.json()).toMatchObject({
      configured: false,
      source: "missing",
    });

    const saved = await app.fetch(
      new Request(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({ apiKey: "private-tool-key" }),
      })
    );

    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      configured: true,
      source: "settings",
    });
    expect(await loadToolApiKey(orgId, "tool_key")).toBe("private-tool-key");
    expect(await loadToolApiKey("another_org", "tool_key")).toBeUndefined();
    expect(
      await (await app.fetch(new Request(url, { headers }))).json()
    ).toMatchObject({ configured: true, source: "settings" });

    const invalid = await app.fetch(
      new Request(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({ apiKey: "key\n[evil]" }),
      })
    );

    expect(invalid.status).toBe(400);
    expect(await loadToolApiKey(orgId, "tool_key")).toBe("private-tool-key");

    const builtin = await app.fetch(
      new Request(url.replace("tool_key", "tool_builtin"), {
        method: "PUT",
        headers,
        body: JSON.stringify({ apiKey: "builtin-key" }),
      })
    );

    expect(builtin.status).toBe(400);
    expect(await loadToolApiKey(orgId, "tool_builtin")).toBeUndefined();
    const envUrl = url.replace("tool_key", "tool_env");

    const envSaved = await app.fetch(
      new Request(envUrl, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          env: { SERVICE_KEY: "env-secret", SERVICE_URL: "https://svc.test" },
        }),
      })
    );

    expect(envSaved.status).toBe(200);

    const envStatus = await (
      await app.fetch(new Request(envUrl, { headers }))
    ).text();

    expect(JSON.parse(envStatus)).toMatchObject({
      configured: false,
      env: [
        {
          configured: true,
          name: "SERVICE_URL",
          secret: false,
          value: "https://svc.test",
        },
        { configured: true, name: "SERVICE_KEY", secret: true },
      ],
    });
    expect(envStatus).not.toContain("env-secret");

    const undeclared = await app.fetch(
      new Request(envUrl, {
        method: "PUT",
        headers,
        body: JSON.stringify({ env: { PATH: "/tmp/evil" } }),
      })
    );

    expect(undeclared.status).toBe(400);
    visibleOrg = "other_org";
    expect(
      (
        await app.fetch(
          new Request(url, {
            method: "PUT",
            headers,
            body: JSON.stringify({ apiKey: "overwrite" }),
          })
        )
      ).status
    ).toBe(404);
    expect((await app.fetch(new Request(url))).status).toBe(401);
  });
  test("GET source is allowed for plugin-owned tools", async () => {
    const { app, authService, databaseAdapter } = createApp({
      getTool: async (toolId: string) => ({
        tool: {
          createdAt: new Date().toISOString(),
          description: "Plugin write",
          handlerConfig: { actionKey: "write" },
          handlerType: "plugin",
          id: toolId,
          name: "notes_write",
          pluginId: "notes",
          pluginKey: "write",
          updatedAt: new Date().toISOString(),
        },
      }),
      getToolSource: async () => ({
        content: "",
        language: "javascript" as const,
        path: "plugins/notes/write",
      }),
    });

    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "acme-plugin-source",
      "admin-plugin-source@acme.com"
    );

    const source = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_plugin/source", {
        headers: adminSession.headers({}, orgId),
      })
    );

    expect(source.status).toBe(200);
    await expect(source.json()).resolves.toMatchObject({
      path: "plugins/notes/write",
    });
  });

  test("org member cannot read tool detail", async () => {
    const { app, authService, databaseAdapter } = createApp();

    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "acme-member",
      "admin-member@acme.com"
    );

    const addMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "member@acme.com",
          name: "Member One",
          phone: "+628111111111",
          role: "member",
        }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(addMemberResponse.status).toBe(201);

    // SAFETY: This test controls the fixture shape at this boundary.
    const memberProvisioned = (await addMemberResponse.json()) as {
      temporaryPassword: string;
    };

    const memberSession = await loginUserSession(
      app,
      "member@acme.com",
      memberProvisioned.temporaryPassword,
      orgId
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_echo", {
        headers: memberSession.headers({}, orgId),
      })
    );

    expect(response.status).toBe(403);

    for (const method of ["GET", "PUT"]) {
      const credentialResponse = await app.fetch(
        new Request("http://localhost:4310/v1/tools/tool_echo/credentials", {
          method,
          headers: memberSession.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": memberSession.csrfToken,
            },
            orgId
          ),
          body:
            method === "PUT"
              ? JSON.stringify({ apiKey: "not-allowed" })
              : undefined,
        })
      );

      expect(credentialResponse.status).toBe(403);
    }

    for (const method of ["GET", "POST"]) {
      const response = await app.fetch(
        new Request(
          `http://localhost:4310/v1/tool-setups/${crypto.randomUUID()}`,
          {
            method,
            headers: memberSession.headers(
              {
                "Content-Type": "application/json",
                "X-CSRF-Token": memberSession.csrfToken,
              },
              orgId
            ),
            body:
              method === "POST"
                ? JSON.stringify({ apiKey: "secret" })
                : undefined,
          }
        )
      );

      expect(response.status).toBe(403);
    }
  });

  test("org admin can run a javascript tool", async () => {
    const { app, authService, databaseAdapter } = createApp();

    const platformSession = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({
          admin: {
            email: "admin-run@acme.com",
            name: "Acme Admin",
            phone: "+628123456789",
          },
          name: "Acme",
          slug: "acme-run",
        }),
        headers: platformSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        method: "POST",
      })
    );

    // SAFETY: This test controls the fixture shape at this boundary.
    const created = (await createResponse.json()) as {
      organization: { id: string };
      adminMember: { temporaryPassword: string };
    };

    const adminSession = await loginUserSession(
      app,
      "admin-run@acme.com",
      created.adminMember.temporaryPassword,
      created.organization.id
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_echo/run", {
        body: JSON.stringify({ parameters: { query: "hello" } }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          created.organization.id
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    // SAFETY: This test controls the fixture shape at this boundary.
    const body = (await response.json()) as { ok: boolean; result: unknown };
    expect(body.ok).toBe(true);
    expect(body.result).toEqual({ echo: "hello" });
  });

  test("org member cannot run a tool in the playground", async () => {
    const { app, authService, databaseAdapter } = createApp();

    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "acme-run-deny",
      "admin-run-deny@acme.com"
    );

    const addMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "member-run@acme.com",
          name: "Member One",
          phone: "+628111111111",
          role: "member",
        }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(addMemberResponse.status).toBe(201);

    // SAFETY: This test controls the fixture shape at this boundary.
    const memberProvisioned = (await addMemberResponse.json()) as {
      temporaryPassword: string;
    };

    const memberSession = await loginUserSession(
      app,
      "member-run@acme.com",
      memberProvisioned.temporaryPassword,
      orgId
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_echo/run", {
        body: JSON.stringify({ parameters: { query: "hello" } }),
        headers: memberSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": memberSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(403);
  });

  test("non-javascript tools return 400 on run", async () => {
    const { app, authService, databaseAdapter } = createApp({
      runToolPlayground: async () => {
        throw new Error(
          "Only custom JavaScript tools can be run in the playground."
        );
      },
    });

    const platformSession = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({
          admin: {
            email: "admin-builtin@acme.com",
            name: "Acme Admin",
            phone: "+628123456789",
          },
          name: "Acme",
          slug: "acme-builtin",
        }),
        headers: platformSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        method: "POST",
      })
    );

    // SAFETY: This test controls the fixture shape at this boundary.
    const created = (await createResponse.json()) as {
      organization: { id: string };
      adminMember: { temporaryPassword: string };
    };

    const adminSession = await loginUserSession(
      app,
      "admin-builtin@acme.com",
      created.adminMember.temporaryPassword,
      created.organization.id
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_builtin/run", {
        body: JSON.stringify({ parameters: {} }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          created.organization.id
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
  });

  test("run does not leak an unexpected error's message", async () => {
    const { app, authService, databaseAdapter } = createApp({
      runToolPlayground: async () => {
        throw new Error(
          "SQLITE_CONSTRAINT: UNIQUE constraint failed at /home/nakama/.config/nakama/nakama.db"
        );
      },
    });

    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "acme-run-leak",
      "admin-run-leak@acme.com"
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_echo/run", {
        body: JSON.stringify({ parameters: {} }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "An unexpected server error occurred.",
    });
  });

  test("run still maps a not-found message to 404 without leaking it", async () => {
    const { app, authService, databaseAdapter } = createApp({
      runToolPlayground: async () => {
        throw new NakamaApiError("Tool not found.", 404);
      },
    });

    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "acme-run-404",
      "admin-run-404@acme.com"
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_missing/run", {
        body: JSON.stringify({ parameters: {} }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Tool not found.",
    });
  });
});

describe("custom tool tenant isolation (#1091)", () => {
  async function setup() {
    const { databaseAdapter: db } = createApp();
    const service = new ProfileService(db);
    const now = new Date().toISOString();

    for (const id of ["iso_org_a", "iso_org_b"]) {
      await db.upsertOrganization({
        id,
        name: id,
        slug: id,
        createdAt: now,
        updatedAt: now,
      });
      await mkdir(getCustomToolsDir(id), { recursive: true });
    }

    return { db, service };
  }

  const MODULE = "export async function run() { return 'org-a-secret'; }";

  test("org B cannot read source or details of org A's tool", async () => {
    const { service } = await setup();
    await writeFile(
      join(getCustomToolsDir("iso_org_a"), "iso-secret.js"),
      MODULE
    );

    const { id } = await service.createTool(
      {
        description: "A tool",
        handlerConfig: { modulePath: "iso-secret.js" },
        handlerType: "javascript",
        name: "iso_secret",
      },
      "iso_org_a"
    );

    await expect(service.getToolSource(id, "iso_org_a")).resolves.toMatchObject(
      { content: MODULE }
    );
    await expect(service.getToolSource(id, "iso_org_b")).rejects.toThrow();
    await expect(service.getTool(id, "iso_org_b")).rejects.toThrow();
  });

  test("org B cannot register a tool over org A's module file", async () => {
    const { service } = await setup();
    await writeFile(
      join(getCustomToolsDir("iso_org_a"), "iso-a-module.js"),
      MODULE
    );

    await expect(
      service.createTool(
        {
          description: "B",
          handlerConfig: {
            modulePath: join(getCustomToolsDir("iso_org_a"), "iso-a-module.js"),
          },
          handlerType: "javascript",
          name: "iso_b",
        },
        "iso_org_b"
      )
    ).rejects.toThrow();
  });

  test("an ownerless custom tool is hidden from every org", async () => {
    const { db, service } = await setup();
    const now = new Date().toISOString();
    await db.upsertTool({
      createdAt: now,
      description: "legacy",
      handlerConfig: { modulePath: "legacy.js" },
      handlerType: "javascript",
      id: "iso_legacy",
      name: "iso_legacy",
      updatedAt: now,
    });

    const { tools } = await service.listTools("iso_org_b");

    expect(tools.some((tool) => tool.id === "iso_legacy")).toBe(false);
    await expect(
      service.getToolSource("iso_legacy", "iso_org_b")
    ).rejects.toThrow();
  });

  test("legacy tools are claimed by the one org that uses them", async () => {
    const { db, service } = await setup();
    const now = new Date().toISOString();
    await mkdir(getCustomToolsDir(), { recursive: true });

    for (const file of ["legacy-one.js", "legacy-shared.js"]) {
      await writeFile(join(getCustomToolsDir(), file), MODULE);
    }

    for (const id of ["iso_legacy_one", "iso_legacy_shared"]) {
      await db.upsertTool({
        createdAt: now,
        description: id,
        handlerConfig: {
          modulePath: `${id.replace("iso_", "").replace("_", "-")}.js`,
        },
        handlerType: "javascript",
        id,
        name: id,
        updatedAt: now,
      });
    }

    for (const [profileId, orgId] of [
      ["iso_profile_a", "iso_org_a"],
      ["iso_profile_b", "iso_org_b"],
    ] as const) {
      await db.upsertProfile({
        createdAt: now,
        id: profileId,
        isDefault: false,
        isSuper: false,
        model: null,
        name: profileId,
        orgId,
        systemPrompt: "",
        updatedAt: now,
      });
    }

    await db.assignToolToProfile("iso_profile_a", "iso_legacy_one");
    await db.assignToolToProfile("iso_profile_a", "iso_legacy_shared");
    await db.assignToolToProfile("iso_profile_b", "iso_legacy_shared");

    await claimLegacyCustomTools(db);

    await expect(
      service.getToolSource("iso_legacy_one", "iso_org_a")
    ).resolves.toMatchObject({ content: MODULE });
    await expect(
      service.getToolSource("iso_legacy_one", "iso_org_b")
    ).rejects.toThrow();
    expect((await db.getTool("iso_legacy_shared"))?.orgId).toBeFalsy();
  });
});
