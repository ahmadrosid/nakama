import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getUserConfigDir, saveUserConfig } from "@nakama/core";
import { NakamaAuthExpiredError, NakamaClient } from "./index";

const organizationRequests = [
  {
    body: null,
    call: (client: NakamaClient) => client.getTool("tool/a?", "team/a?"),
    method: "GET",
    path: "/v1/tools/tool%2Fa%3F",
    response: { tool: { id: "tool/a?", name: "Shared tool" } },
  },
  {
    body: null,
    call: (client: NakamaClient) =>
      client.listPublishedSkillFiles("team/a?", "publication/a?"),
    method: "GET",
    path: "/v1/orgs/team%2Fa%3F/shared-resources/publication%2Fa%3F/skill/files",
    response: {
      files: [{ path: "references/guide.md", type: "file" }],
      truncated: false,
    },
  },
  {
    body: null,
    call: (client: NakamaClient) =>
      client.readPublishedSkillFile(
        "team/a?",
        "publication/a?",
        "references/a b?.md"
      ),
    method: "GET",
    path: "/v1/orgs/team%2Fa%3F/shared-resources/publication%2Fa%3F/skill/file?path=references%2Fa+b%3F.md",
    response: { content: "Shared reference", path: "references/a b?.md" },
  },
  {
    body: null,
    call: (client: NakamaClient) =>
      client.getPublishedSkill("team/a?", "publication/a?"),
    method: "GET",
    path: "/v1/orgs/team%2Fa%3F/shared-resources/publication%2Fa%3F/skill",
    response: {
      skill: {
        body: "Shared instructions",
        id: "parent-skill",
        publicationId: "publication/a?",
      },
    },
  },
  {
    body: null,
    call: (client: NakamaClient) => client.getOrganizationOverview("team/a?"),
    method: "GET",
    path: "/v1/orgs/team%2Fa%3F/overview",
    response: { activeOrgId: "team/a?", sharedResources: [], teams: [] },
  },
  {
    body: {
      adminUserId: "user-2",
      name: "Sales",
      requestId: "retry-1",
      slug: "sales",
    },
    call: (client: NakamaClient) =>
      client.createTeam("team/a?", {
        adminUserId: "user-2",
        name: "Sales",
        requestId: "retry-1",
        slug: "sales",
      }),
    method: "POST",
    path: "/v1/orgs/team%2Fa%3F/teams",
    response: { organization: { id: "sales" } },
  },
  {
    body: null,
    call: (client: NakamaClient) => client.listOrgSharedResources("team/a?"),
    method: "GET",
    path: "/v1/orgs/team%2Fa%3F/shared-resources",
    response: { resources: [] },
  },
  {
    body: { resourceId: "provider::model", resourceKind: "model" },
    call: (client: NakamaClient) =>
      client.publishOrgSharedResource("team/a?", {
        resourceId: "provider::model",
        resourceKind: "model",
      }),
    method: "POST",
    path: "/v1/orgs/team%2Fa%3F/shared-resources",
    response: { publication: { id: "publication/a?" } },
  },
  {
    body: null,
    call: (client: NakamaClient) =>
      client.unpublishOrgSharedResource("team/a?", "publication/a?"),
    method: "DELETE",
    path: "/v1/orgs/team%2Fa%3F/shared-resources/publication%2Fa%3F",
    response: undefined,
  },
  {
    body: null,
    call: (client: NakamaClient) =>
      client.createSharedAgentInstance("team/a?", "publication/a?"),
    method: "POST",
    path: "/v1/orgs/team%2Fa%3F/shared-agents/publication%2Fa%3F/instance",
    response: { profile: { id: "team-agent" } },
  },
];

const authScopeUser = {
  activeOrgId: "team-a",
  email: "user@example.com",
  id: "user",
  isPlatformAdmin: false,
};

const authScopeRequests = [
  {
    call: (client: NakamaClient) =>
      client.login("user@example.com", "password"),
    method: "POST",
    path: "/v1/auth/login",
    response: authScopeUser,
  },
  {
    call: (client: NakamaClient) =>
      client.setupUser({
        admin: {
          email: "user@example.com",
          name: "User",
          password: "password",
        },
        organization: { name: "Team A", slug: "team-a" },
      }),
    method: "POST",
    path: "/v1/auth/setup",
    response: authScopeUser,
  },
  {
    call: (client: NakamaClient) =>
      client.updateAuthProfile({ name: "Updated" }),
    method: "PATCH",
    path: "/v1/auth/me",
    response: authScopeUser,
  },
  {
    call: (client: NakamaClient) => client.acceptOrgInvite({ token: "invite" }),
    method: "POST",
    path: "/v1/auth/accept-invite",
    response: {
      email: "user@example.com",
      orgId: "team-a",
      role: "member" as const,
    },
  },
];

for (const action of authScopeRequests) {
  test.each(["switch", "reset", "current"] as const)(
    `${action.method} ${action.path} preserves client scope after %s`,
    async (mode) => {
      const pending = Promise.withResolvers<Response>();
      const requests: Request[] = [];

      const client = new NakamaClient({
        baseUrl: "http://localhost",
        fetch: async (input, init) => {
          const request = new Request(input, init);
          requests.push(request);
          const path = new URL(request.url).pathname;

          if (path === action.path) {
            expect(request.method).toBe(action.method);

            return await pending.promise;
          }

          if (path === "/v1/auth/active-org") {
            return Response.json({ activeOrgId: "team-b", id: "user" });
          }

          return Response.json({ profiles: [] });
        },
        orgId: "original",
      });

      const updating = action.call(client);

      if (mode === "switch") {
        await client.setActiveOrg("team-b");
      } else if (mode === "reset") {
        client.setOrgId(null);
      }

      pending.resolve(Response.json(action.response));
      expect(await updating).toEqual(action.response);
      await client.listProfiles();
      expect(requests.at(-1)?.headers.get("X-Org-Id")).toBe(
        mode === "switch" ? "team-b" : mode === "reset" ? null : "team-a"
      );
    }
  );
}

test.each(["switch", "reset"] as const)(
  "a late identity read cannot replace client scope after %s",
  async (mode) => {
    const pending = Promise.withResolvers<Response>();
    const requests: Request[] = [];

    const client = new NakamaClient({
      baseUrl: "http://localhost",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);

        if (new URL(request.url).pathname === "/v1/auth/me") {
          return await pending.promise;
        }

        if (new URL(request.url).pathname === "/v1/auth/active-org") {
          return Response.json({ activeOrgId: "team-b", id: "user" });
        }

        return Response.json({ profiles: [] });
      },
      orgId: "team-a",
    });

    const identity = client.getMe();

    if (mode === "switch") {
      await client.setActiveOrg("team-b");
    } else {
      client.setOrgId(null);
    }

    pending.resolve(Response.json({ activeOrgId: "team-a", id: "user" }));
    expect((await identity).activeOrgId).toBe("team-a");
    await client.listProfiles();
    expect(requests.at(-1)?.headers.get("X-Org-Id")).toBe(
      mode === "switch" ? "team-b" : null
    );
  }
);

test("a delayed switch cannot restore a cleared client scope", async () => {
  const pending = Promise.withResolvers<Response>();
  const requests: Request[] = [];

  const client = new NakamaClient({
    baseUrl: "http://localhost",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);

      if (new URL(request.url).pathname === "/v1/auth/active-org") {
        return await pending.promise;
      }

      return Response.json({ profiles: [] });
    },
  });

  const switching = client.setActiveOrg("team-a");
  client.setOrgId(null);
  pending.resolve(Response.json({ activeOrgId: "team-a", id: "user" }));
  expect((await switching).activeOrgId).toBe("team-a");
  await client.listProfiles();
  expect(requests.at(-1)?.headers.get("X-Org-Id")).toBeNull();
});

test("an unchanged identity read does not discard a pending team switch", async () => {
  const pending = Promise.withResolvers<Response>();
  const requests: Request[] = [];

  const client = new NakamaClient({
    baseUrl: "http://localhost",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const path = new URL(request.url).pathname;

      if (path === "/v1/auth/active-org") {
        return await pending.promise;
      }

      if (path === "/v1/auth/me") {
        return Response.json({ activeOrgId: "team-a", id: "user" });
      }

      return Response.json({ profiles: [] });
    },
    orgId: "team-a",
  });

  const switching = client.setActiveOrg("team-b");
  await client.getMe();
  pending.resolve(Response.json({ activeOrgId: "team-b", id: "user" }));
  await switching;
  await client.listProfiles();
  expect(requests.at(-1)?.headers.get("X-Org-Id")).toBe("team-b");
});

test("a current identity read still selects the server's active tenant", async () => {
  const requests: Request[] = [];

  const client = new NakamaClient({
    baseUrl: "http://localhost",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);

      return Response.json(
        new URL(request.url).pathname === "/v1/auth/me"
          ? { activeOrgId: "team-b", id: "user" }
          : { profiles: [] }
      );
    },
    orgId: "team-a",
  });

  expect((await client.getMe()).activeOrgId).toBe("team-b");
  await client.listProfiles();
  expect(requests.at(-1)?.headers.get("X-Org-Id")).toBe("team-b");
});

test.each([false, true])(
  "the newest switch owns client scope; newest response first=%s",
  async (newestFirst) => {
    const first = Promise.withResolvers<Response>();
    const second = Promise.withResolvers<Response>();
    const requests: Request[] = [];

    const client = new NakamaClient({
      baseUrl: "http://localhost",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);

        if (new URL(request.url).pathname === "/v1/auth/active-org") {
          const body = await request.json();

          return await (body.orgId === "team-b"
            ? first.promise
            : second.promise);
        }

        return Response.json({ profiles: [] });
      },
      orgId: "team-a",
    });

    const switchingFirst = client.setActiveOrg("team-b");
    const switchingSecond = client.setActiveOrg("team-c");

    if (newestFirst) {
      second.resolve(Response.json({ activeOrgId: "team-c", id: "user" }));
      await switchingSecond;
      first.resolve(Response.json({ activeOrgId: "team-b", id: "user" }));
    } else {
      first.resolve(Response.json({ activeOrgId: "team-b", id: "user" }));
      await switchingFirst;
      second.resolve(Response.json({ activeOrgId: "team-c", id: "user" }));
    }

    await Promise.all([switchingFirst, switchingSecond]);
    await client.listProfiles();
    expect(requests.at(-1)?.headers.get("X-Org-Id")).toBe("team-c");
  }
);

test.each(organizationRequests)(
  "$method $path uses explicit tenant context and preserves the response",
  async ({ call, method, path, body, response }) => {
    const requests: Request[] = [];

    const client = new NakamaClient({
      authToken: "test-token",
      baseUrl: "https://nakama.example.com",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));

        return response === undefined
          ? new Response(null, { status: 204 })
          : Response.json(response);
      },
      orgId: "other-team",
    });

    expect<unknown>(await call(client)).toEqual(response);
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.url).toBe(`https://nakama.example.com${path}`);
    expect(request.method).toBe(method);
    expect(request.headers.get("X-Org-Id")).toBe("team/a?");
    expect(request.headers.get("Authorization")).toBe("Bearer test-token");

    if (body) {
      expect(request.headers.get("Content-Type")).toBe("application/json");
      expect(await request.json()).toEqual(body);
    } else {
      expect(await request.text()).toBe("");
    }

    await client.listOrgMembers("other-team");
    expect(requests[1]?.headers.get("X-Org-Id")).toBe("other-team");
  }
);

test.each(organizationRequests)(
  "$method $path preserves denied access",
  async ({ call }) => {
    const client = new NakamaClient({
      baseUrl: "https://nakama.example.com",
      fetch: async () => Response.json({ error: "denied" }, { status: 403 }),
    });

    await expect(call(client)).rejects.toMatchObject({ status: 403 });
  }
);

test.each(["http://localhost:4310", "https://nakama.example.com"])(
  "CLI images are uploaded in the request body to %s",
  async (baseUrl) => {
    const requests: Request[] = [];

    const client = new NakamaClient({
      authToken: "test-token",
      baseUrl,
      fetch: async (input, init) => {
        requests.push(new Request(input, init));

        return new Response('data: {"type":"done","reply":"ok"}\n\n', {
          headers: { "Content-Type": "text/event-stream" },
        });
      },
      orgId: "org-a",
    });

    const images = [{ data: "aW1hZ2U=", mediaType: "image/png" }];
    const session = client.createChatSession("session-1", "cli");

    const whatsappMessage = {
      chatJid: "chat@g.us",
      fromMe: false,
      isGroup: true,
      senderJid: "sender@s.whatsapp.net",
      senderJids: ["sender@s.whatsapp.net"],
    };

    await session.sendStream({ images, message: "Describe this" }, () => {}, {
      whatsappContextToken: "internal-worker-token",
      whatsappMessage,
    });
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.url).toBe(
      `${baseUrl}/v1/sessions/session-1/messages?stream=true`
    );
    expect(request.headers.get("Authorization")).toBe("Bearer test-token");
    expect(request.headers.get("X-Org-Id")).toBe("org-a");
    expect(request.headers.get("X-Nakama-WhatsApp-Context-Token")).toBe(
      "internal-worker-token"
    );
    expect(await request.json()).toMatchObject({
      images,
      message: "Describe this",
      stream: true,
      whatsappMessage,
    });
  }
);

test("scoped clients keep session requests in their original organization", async () => {
  const requests: Request[] = [];

  const client = new NakamaClient({
    authToken: "test-token",
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      requests.push(new Request(input, init));

      return Response.json({ messages: [] });
    },
  });

  const first = client.forOrg("org_a").createChatSession("first", "discord");
  const second = client.forOrg("org_b").createChatSession("second", "discord");
  client.setOrgId("org_c");
  await Promise.all([first.getMessages(), second.getMessages()]);
  expect(requests.map((request) => request.headers.get("X-Org-Id"))).toEqual([
    "org_a",
    "org_b",
  ]);
  expect(
    requests.every(
      (request) => request.headers.get("Authorization") === "Bearer test-token"
    )
  ).toBe(true);
});

test("plugin access requests retain their explicit organization", async () => {
  const requests: Request[] = [];

  const client = new NakamaClient({
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      requests.push(new Request(input, init));

      return Response.json({});
    },
    orgId: "org-other",
  });

  await client.getProfile("agent-a", "org-a");
  await client.listTools("org-a");
  await client.listSkills("org-a");
  await client.assignTool("agent-a", { toolId: "tool" }, "org-a");
  await client.unassignTool("agent-a", "tool", "org-a");
  await client.assignSkill("agent-a", { skillId: "skill" }, "org-a");
  await client.unassignSkill("agent-a", "skill", "org-a");
  expect(requests).toHaveLength(7);
  expect(requests.map((request) => request.headers.get("X-Org-Id"))).toEqual(
    Array(7).fill("org-a")
  );
  expect(requests.map((request) => request.method)).toEqual([
    "GET",
    "GET",
    "GET",
    "POST",
    "DELETE",
    "POST",
    "DELETE",
  ]);
});

test("official plugin reinstall sends revision and explicit organization", async () => {
  let request!: Request;

  const client = new NakamaClient({
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      request = new Request(input, init);

      return Response.json({ install: { lifecycleState: "enabled" } });
    },
  });

  await client.reinstallOfficialPlugin("workflows", 7, "org-a");
  expect(new URL(request.url).pathname).toBe(
    "/v1/plugins/official/workflows/reinstall"
  );
  expect(request.method).toBe("POST");
  expect(request.headers.get("X-Org-Id")).toBe("org-a");
  expect(await request.json()).toEqual({ expectedRevision: 7 });
});

test("local draft transport pins the explicit organization, digest, revision, and review offset", async () => {
  const requests: Request[] = [];

  const client = new NakamaClient({
    baseUrl: "http://localhost",
    fetch: async (input, init) => {
      requests.push(new Request(input, init));

      return Response.json({});
    },
    orgId: "other-org",
  });

  const draft = { draftId: "notes", orgId: "reviewed-org", profileId: "super" };
  await client.previewLocalPlugin(draft);
  await client.readLocalPluginFile({
    ...draft,
    expectedDigest: "a".repeat(64),
    offset: 1024,
    path: "src/list.js",
  });
  await client.installLocalPlugin({
    ...draft,
    expectedDigest: "a".repeat(64),
    expectedRevision: 7,
  });
  expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
    "/v1/platform/plugins/preview-local",
    "/v1/platform/plugins/local-file",
    "/v1/platform/plugins/install-local",
  ]);
  expect(await requests[0]!.json()).toEqual(draft);
  expect(await requests[1]!.json()).toMatchObject({
    ...draft,
    expectedDigest: "a".repeat(64),
    offset: 1024,
  });
  expect(await requests[2]!.json()).toEqual({
    ...draft,
    expectedDigest: "a".repeat(64),
    expectedRevision: 7,
  });
});

test("chat stream request includes cookie CSRF protection", async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  );

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { cookie: "nakama_csrf=csrf-token-123; other=value" },
  });

  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];

  const client = new NakamaClient({
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      fetchCalls.push({ init, input });

      return new Response('data: {"type":"done","reply":"ok"}\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  });

  try {
    const session = client.createChatSession("session-1", "web");
    const reply = await session.sendStream("hello", () => {});

    expect(reply).toBe("ok");
    expect(fetchCalls).toHaveLength(1);

    const headers = new Headers(fetchCalls[0]!.init?.headers);
    expect(headers.get("X-CSRF-Token")).toBe("csrf-token-123");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(fetchCalls[0]!.init?.credentials).toBe("include");
    expect(
      // SAFETY: The client adds Bun's idleTimeout option to this captured request.
      (fetchCalls[0]!.init as RequestInit & { idleTimeout?: number })
        .idleTimeout
    ).toBe(0);
  } finally {
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  }
});

test("CSRF header prefers the host-bound cookie a sibling host cannot set", async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  );

  // An attacker-planted parent-domain cookie is still readable from JS, so the
  // client must send the host-bound one the server actually trusts.

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { cookie: "nakama_csrf=planted; __Host-nakama_csrf=host-bound" },
  });

  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];

  const client = new NakamaClient({
    baseUrl: "https://nakama.example.com",
    fetch: async (input, init) => {
      fetchCalls.push({ init, input });

      return new Response('data: {"type":"done","reply":"ok"}\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  });

  try {
    await client
      .createChatSession("session-1", "web")
      .sendStream("hi", () => {});

    expect(new Headers(fetchCalls[0]!.init?.headers).get("X-CSRF-Token")).toBe(
      "host-bound"
    );
  } finally {
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  }
});

test("automation run requests disable Bun fetch idle timeout", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];

  const client = new NakamaClient({
    authToken: "local-auth-token",
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      fetchCalls.push({ init, input });

      return new Response(null, { status: 204 });
    },
  });

  await client.runAutomationInternal("auto_1", "org_1");

  expect(String(fetchCalls[0]!.input)).toBe(
    "http://localhost:4310/v1/internal/automations/auto_1/run?orgId=org_1"
  );
  expect(
    // SAFETY: The client adds Bun's idleTimeout option to this captured request.
    (fetchCalls[0]!.init as RequestInit & { idleTimeout?: number }).idleTimeout
  ).toBe(0);
});

test("clients send org context on authenticated requests", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];

  const client = new NakamaClient({
    authToken: "local-auth-token",
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      fetchCalls.push({ init, input });

      return Response.json({ profiles: [] });
    },
    orgId: "org_test",
  });

  await client.listProfiles();

  const headers = new Headers(fetchCalls[0]!.init?.headers);
  expect(headers.get("Authorization")).toBe("Bearer local-auth-token");
  expect(headers.get("X-Org-Id")).toBe("org_test");
});

test("listProfiles takes an org id per call, overriding the client's", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];

  const client = new NakamaClient({
    authToken: "local-auth-token",
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      fetchCalls.push({ init, input });

      return Response.json({ profiles: [] });
    },
    orgId: "org_test",
  });

  await client.listProfiles("org_other");

  const headers = new Headers(fetchCalls[0]!.init?.headers);
  expect(headers.get("X-Org-Id")).toBe("org_other");
});

test("non-browser clients send local auth as a bearer token", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];

  const client = new NakamaClient({
    authToken: "local-auth-token",
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      fetchCalls.push({ init, input });

      return Response.json({ ok: true });
    },
  });

  await client.health();

  const headers = new Headers(fetchCalls[0]!.init?.headers);
  expect(headers.get("Authorization")).toBe("Bearer local-auth-token");
  expect(headers.get("Content-Type")).toBeNull();
});

test("data export downloads zip bytes with filename metadata", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];

  const client = new NakamaClient({
    authToken: "local-auth-token",
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      fetchCalls.push({ init, input });

      return new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "Content-Disposition":
            'attachment; filename="nakama-export-test.zip"',
          "Content-Type": "application/zip",
        },
      });
    },
  });

  const result = await client.exportData();

  expect(fetchCalls[0]!.input.toString()).toBe(
    "http://localhost:4310/v1/platform/data/export"
  );
  const headers = new Headers(fetchCalls[0]!.init?.headers);
  expect(headers.get("Authorization")).toBe("Bearer local-auth-token");
  expect(headers.get("Content-Type")).toBeNull();
  expect(result.filename).toBe("nakama-export-test.zip");
  expect(Array.from(new Uint8Array(result.data))).toEqual([1, 2, 3]);
});

test("user data export scopes the download path to the requested user", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];

  const client = new NakamaClient({
    authToken: "local-auth-token",
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      fetchCalls.push({ init, input });

      return new Response(new Uint8Array([4, 5, 6]), {
        headers: {
          "Content-Disposition":
            'attachment; filename="nakama-user-export-test.zip"',
          "Content-Type": "application/zip",
        },
      });
    },
  });

  const result = await client.exportUserData("user/with space");

  expect(fetchCalls[0]!.input.toString()).toBe(
    "http://localhost:4310/v1/platform/users/user%2Fwith%20space/data/export"
  );
  expect(result.filename).toBe("nakama-user-export-test.zip");
  expect(Array.from(new Uint8Array(result.data))).toEqual([4, 5, 6]);
});

test("profile pack helpers export zip and upload base64 preview/import bodies", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];

  const client = new NakamaClient({
    authToken: "local-auth-token",
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      fetchCalls.push({ init, input });
      const url = input.toString();

      if (url.includes("/pack/export")) {
        return new Response(new Uint8Array([9, 8, 7]), {
          headers: {
            "Content-Disposition":
              'attachment; filename="nakama-profile-export-bot.zip"',
            "Content-Type": "application/zip",
          },
        });
      }

      if (url.endsWith("/pack/import/preview")) {
        return Response.json({
          manifest: { kind: "nakama-profile-export" },
          plannedName: "Bot",
          skippedAssignments: [],
          topLevelPaths: ["SOUL.md"],
        });
      }

      return Response.json({
        manifest: { kind: "nakama-profile-export" },
        profileId: "profile_new",
        skippedAssignments: [],
      });
    },
    orgId: "org_test",
  });

  const exported = await client.exportProfilePack("profile_1");
  expect(fetchCalls[0]!.input.toString()).toBe(
    "http://localhost:4310/v1/profiles/profile_1/pack/export"
  );
  expect(exported.filename).toBe("nakama-profile-export-bot.zip");

  await expect(
    client.previewProfilePackImport(new Uint8Array([1, 2, 3]))
  ).resolves.toMatchObject({ plannedName: "Bot" });
  await expect(
    client.importProfilePack(new Uint8Array([4, 5, 6]), {
      confirm: true,
      name: "Bot Copy",
    })
  ).resolves.toMatchObject({ profileId: "profile_new" });

  expect(JSON.parse(String(fetchCalls[1]!.init?.body))).toEqual({
    data: Buffer.from([1, 2, 3]).toString("base64"),
  });
  expect(JSON.parse(String(fetchCalls[2]!.init?.body))).toEqual({
    confirm: true,
    data: Buffer.from([4, 5, 6]).toString("base64"),
    name: "Bot Copy",
  });
});

test("readProfileArtifactContent fetches artifact bytes with inline query", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];

  const client = new NakamaClient({
    authToken: "local-auth-token",
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      fetchCalls.push({ init, input });

      return new Response("# Report", {
        headers: {
          "Content-Disposition": 'inline; filename="report.md"',
          "Content-Type": "text/markdown",
        },
      });
    },
    orgId: "org_test",
  });

  const result = await client.readProfileArtifactContent(
    "profile_1",
    "weekly/report.md",
    {
      inline: true,
    }
  );

  expect(fetchCalls[0]!.input.toString()).toBe(
    "http://localhost:4310/v1/profiles/profile_1/artifacts/content?path=weekly%2Freport.md&inline=1"
  );
  const headers = new Headers(fetchCalls[0]!.init?.headers);
  expect(headers.get("Authorization")).toBe("Bearer local-auth-token");
  expect(headers.get("X-Org-Id")).toBe("org_test");
  expect(result.contentType).toBe("text/markdown");
  expect(new TextDecoder().decode(result.data)).toBe("# Report");
});

test("hasProfileArtifact reads a 404 as deleted and rethrows other failures", async () => {
  const methods: Array<string | undefined> = [];
  let status = 200;

  const client = new NakamaClient({
    authToken: "local-auth-token",
    baseUrl: "http://localhost:4310",
    fetch: async (_input, init) => {
      methods.push(init?.method);

      return new Response(null, { status });
    },
    orgId: "org_test",
  });

  expect(await client.hasProfileArtifact("profile_1", "report.md")).toBe(true);
  status = 404;
  expect(await client.hasProfileArtifact("profile_1", "report.md")).toBe(false);
  status = 500;
  await expect(
    client.hasProfileArtifact("profile_1", "report.md")
  ).rejects.toMatchObject({ status: 500 });
  expect(methods).toEqual(["HEAD", "HEAD", "HEAD"]);
});

test("data import helpers upload base64 archive data", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];

  const client = new NakamaClient({
    authToken: "local-auth-token",
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      fetchCalls.push({ init, input });

      if (input.toString().endsWith("/preview")) {
        return Response.json({
          archiveFileCount: 1,
          archiveTotalBytes: 3,
          manifest: { kind: "nakama-export" },
          topLevelPaths: ["config.ini"],
          willReplaceRoot: true,
        });
      }

      return Response.json({
        manifest: { kind: "nakama-export" },
        restoredFileCount: 1,
        restoredRoot: "/tmp/nakama",
      });
    },
  });

  await expect(
    client.previewDataImport(new Uint8Array([1, 2, 3]))
  ).resolves.toMatchObject({
    archiveFileCount: 1,
  });
  await expect(
    client.restoreDataImport(new Uint8Array([4, 5, 6]), { confirm: true })
  ).resolves.toMatchObject({ restoredFileCount: 1 });

  expect(JSON.parse(String(fetchCalls[0]!.init?.body))).toEqual({
    data: "AQID",
  });
  expect(JSON.parse(String(fetchCalls[1]!.init?.body))).toEqual({
    confirm: true,
    data: "BAUG",
  });
  expect(new Headers(fetchCalls[1]!.init?.headers).get("Authorization")).toBe(
    "Bearer local-auth-token"
  );
});

test("non-browser clients reload the local auth token once after a 401", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "nakama-client-auth-reload-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;

  try {
    await writeFile(
      join(getUserConfigDir(), "local-auth-token"),
      "tc_local_stale\n",
      "utf8"
    );
    await saveUserConfig({
      defaultProviderId: null,
      localAuthTokenHash: createHash("sha256")
        .update("tc_local_fresh")
        .digest("hex"),
      providers: [],
    });
    await writeFile(
      join(getUserConfigDir(), "local-auth-token"),
      "tc_local_fresh\n",
      "utf8"
    );

    let attempts = 0;

    const client = new NakamaClient({
      authToken: "tc_local_stale",
      baseUrl: "http://localhost:4310",
      fetch: async () => {
        attempts += 1;

        if (attempts === 1) {
          return new Response(
            JSON.stringify({ error: "Authentication required" }),
            {
              headers: { "Content-Type": "application/json" },
              status: 401,
            }
          );
        }

        return Response.json({ ok: true });
      },
    });

    await expect(client.health()).resolves.toMatchObject({ ok: true });
    expect(attempts).toBe(2);
  } finally {
    delete process.env.NAKAMA_CONFIG_DIR;
    await rm(configDir, { force: true, recursive: true });
  }
});

test("non-browser clients throw NakamaAuthExpiredError when 401 token is unchanged", async () => {
  const configDir = await mkdtemp(
    join(tmpdir(), "nakama-client-auth-expired-")
  );

  process.env.NAKAMA_CONFIG_DIR = configDir;

  try {
    await writeFile(
      join(getUserConfigDir(), "local-auth-token"),
      "tc_local_same\n",
      "utf8"
    );
    await saveUserConfig({
      defaultProviderId: null,
      localAuthTokenHash: createHash("sha256")
        .update("tc_local_same")
        .digest("hex"),
      providers: [],
    });

    const client = new NakamaClient({
      authToken: "tc_local_same",
      baseUrl: "http://localhost:4310",
      fetch: async () =>
        new Response(JSON.stringify({ error: "Authentication required" }), {
          headers: { "Content-Type": "application/json" },
          status: 401,
        }),
    });

    await expect(client.health()).rejects.toBeInstanceOf(
      NakamaAuthExpiredError
    );
  } finally {
    delete process.env.NAKAMA_CONFIG_DIR;
    await rm(configDir, { force: true, recursive: true });
  }
});

test("notification destination client methods hit the expected routes", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];

  const client = new NakamaClient({
    authToken: "local-auth-token",
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      fetchCalls.push({ init, input });

      if (init?.method === "POST" && input.toString().endsWith("/rotate-key")) {
        return Response.json({
          apiKey: "rotated",
          destination: { id: "dest_1" },
        });
      }

      if (init?.method === "POST") {
        return Response.json({
          apiKey: "created",
          destination: { id: "dest_1" },
        });
      }

      if (init?.method === "PUT") {
        return Response.json({ id: "dest_1", name: "Ops" });
      }

      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      return Response.json({ destinations: [] });
    },
    orgId: "org_test",
  });

  await client.listNotificationDestinations();
  await client.createNotificationDestination({
    channel: "telegram",
    name: "Ops",
    telegram: { chatId: 1001 },
  });
  await client.updateNotificationDestination("dest_1", {
    name: "Ops",
    telegram: { chatId: 1001, topicId: 22 },
  });
  await client.regenerateNotificationDestinationKey("dest_1");
  await client.deleteNotificationDestination("dest_1");

  expect(fetchCalls[0]?.input.toString()).toBe(
    "http://localhost:4310/v1/notification-destinations"
  );
  expect(fetchCalls[1]?.input.toString()).toBe(
    "http://localhost:4310/v1/notification-destinations"
  );
  expect(fetchCalls[2]?.input.toString()).toBe(
    "http://localhost:4310/v1/notification-destinations/dest_1"
  );
  expect(fetchCalls[3]?.input.toString()).toBe(
    "http://localhost:4310/v1/notification-destinations/dest_1/rotate-key"
  );
  expect(fetchCalls[4]?.input.toString()).toBe(
    "http://localhost:4310/v1/notification-destinations/dest_1"
  );
});

function createPublishShareClient(options: {
  clientOrigin?: string;
  response: Record<string, string | boolean | null>;
}) {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];

  const client = new NakamaClient({
    authToken: "local-auth-token",
    baseUrl: "http://127.0.0.1:4310",
    clientOrigin: options.clientOrigin,
    fetch: async (input, init) => {
      fetchCalls.push({ init, input });

      return Response.json(options.response);
    },
    orgId: "org_test",
  });

  return { client, fetchCalls };
}

test("publishProfileArtifactShare includes clientOrigin when configured", async () => {
  const { client, fetchCalls } = createPublishShareClient({
    clientOrigin: "https://nakama.example.com/",
    response: {
      id: "share_1",
      refreshed: false,
      sharePath: "/s/tok",
      shareUrl: "https://nakama.example.com/s/tok",
      token: "tok",
      webPublicUrlConfigured: true,
    },
  });

  await client.publishProfileArtifactShare("profile_1", "report.md");

  expect(fetchCalls).toHaveLength(1);
  expect(fetchCalls[0]!.input.toString()).toBe(
    "http://127.0.0.1:4310/v1/profiles/profile_1/artifacts/shares"
  );
  expect(JSON.parse(String(fetchCalls[0]!.init?.body))).toEqual({
    clientOrigin: "https://nakama.example.com",
    path: "report.md",
  });
});

test("publishProfileArtifactShare omits clientOrigin when unset", async () => {
  const { client, fetchCalls } = createPublishShareClient({
    response: {
      id: "share_1",
      refreshed: false,
      sharePath: "/s/tok",
      shareUrl: null,
      token: "tok",
      webPublicUrlConfigured: false,
    },
  });

  await client.publishProfileArtifactShare("profile_1", "report.md");

  expect(JSON.parse(String(fetchCalls[0]!.init?.body))).toEqual({
    path: "report.md",
  });
});

test("listSessions asks for several channels and a page in one request", async () => {
  const urls: string[] = [];

  const client = new NakamaClient({
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      urls.push(new Request(input, init).url);

      return Response.json({ sessions: [] });
    },
  });

  await client.listSessions("agent-a");
  await client.listSessions("agent-a", ["web", "telegram"], {
    cursor: null,
    limit: 30,
  });
  await client.listSessions("agent-a", ["web"], { cursor: "next", limit: 30 });
  await client.listSessions("agent-a", ["web"], {
    limit: 30,
    query: "budget plan",
  });
  expect(urls.map((url) => new URL(url).search)).toEqual([
    "?channel=web&profileId=agent-a",
    "?channels=web%2Ctelegram&profileId=agent-a&limit=30",
    "?channels=web&profileId=agent-a&limit=30&cursor=next",
    "?channels=web&profileId=agent-a&limit=30&q=budget+plan",
  ]);
});

test("artifact download budget stops declared and chunked oversize bodies", async () => {
  for (const declared of [undefined, "100", "1"]) {
    let cancelled = false;

    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      start(controller) {
        controller.enqueue(new Uint8Array(5));
      },
    });

    const client = new NakamaClient({
      fetch: async () =>
        new Response(body, {
          headers: declared ? { "Content-Length": declared } : {},
        }),
    });

    await expect(
      client.readProfileArtifactContent("profile", "report.csv", {
        maxBytes: 4,
      })
    ).rejects.toThrow();
    expect(cancelled).toBe(true);
  }

  const client = new NakamaClient({
    fetch: async () => new Response("1234"),
  });

  expect(
    new TextDecoder().decode(
      (
        await client.readProfileArtifactContent("profile", "report.csv", {
          maxBytes: 4,
        })
      ).data
    )
  ).toBe("1234");
});

test("artifact download cancellation aborts a pending body read and forwards the signal", async () => {
  const controller = new AbortController();
  let cancelled = false;
  let requestSignal: AbortSignal | null | undefined;

  const client = new NakamaClient({
    fetch: async (_input, init) => {
      requestSignal = init?.signal;

      return new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        })
      );
    },
  });

  const download = client.readProfileArtifactContent("profile", "report.csv", {
    maxBytes: 10,
    signal: controller.signal,
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await expect(download).rejects.toThrow();
  expect(requestSignal).toBe(controller.signal);
  expect(cancelled).toBe(true);
});

test.each([
  { contentType: "application/pdf", options: {}, query: "" },
  {
    contentType: "text/plain; charset=utf-8",
    options: { render: "text" as const },
    query: "?render=text",
  },
  { contentType: null, options: {}, query: "" },
])(
  "published document reads preserve bytes and explicit scope in case %#",
  async ({ contentType, options, query }) => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    const requests: Request[] = [];
    const headers = new Headers();

    if (contentType) {
      headers.set("Content-Type", contentType);
    }

    const client = new NakamaClient({
      authToken: "test-token",
      baseUrl: "https://nakama.example.com",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));

        return new Response(bytes, { headers });
      },
      orgId: "other-team",
    });

    const document = await client.readPublishedKnowledgeBaseDocument(
      "team/a?",
      "publication/a?",
      options
    );

    expect(document.contentType).toBe(
      contentType ?? "application/octet-stream"
    );
    expect(new Uint8Array(document.data)).toEqual(bytes);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      `https://nakama.example.com/v1/orgs/team%2Fa%3F/shared-resources/publication%2Fa%3F/content${query}`
    );
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers.get("X-Org-Id")).toBe("team/a?");
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer test-token");
    expect(await requests[0]?.text()).toBe("");
    await client.readPublishedKnowledgeBaseDocument(
      "other-team",
      "other-publication"
    );
    expect(requests[1]?.headers.get("X-Org-Id")).toBe("other-team");
  }
);

test.each([403, 404])(
  "published document reads preserve denial status %s",
  async (status) => {
    const client = new NakamaClient({
      baseUrl: "https://nakama.example.com",
      fetch: async () => Response.json({ error: "Unavailable" }, { status }),
    });

    await expect(
      client.readPublishedKnowledgeBaseDocument("team-a", "publication-a")
    ).rejects.toMatchObject({ status });
    await expect(
      client.readPublishedKnowledgeBaseDocument("team-a", "publication-a", {
        render: "text",
      })
    ).rejects.toMatchObject({ status });
  }
);

test("tool detail scope overrides one request and preserves the client default", async () => {
  const requests: Request[] = [];

  const client = new NakamaClient({
    baseUrl: "https://nakama.example.com",
    fetch: async (input, init) => {
      requests.push(new Request(input, init));

      return Response.json({ tool: { id: "tool" } });
    },
    orgId: "default-org",
  });

  await client.getTool("tool", "team-org");
  await client.getTool("tool");
  expect(requests.map((request) => request.headers.get("X-Org-Id"))).toEqual([
    "team-org",
    "default-org",
  ]);
  expect(requests.map((request) => request.method)).toEqual(["GET", "GET"]);
});
