import { afterAll, describe, expect, spyOn, test } from "bun:test";
import type { LookupAddress, LookupAllOptions } from "node:dns";
import * as dnsModule from "node:dns/promises";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { z } from "zod";
import { createMinimalHonoApp } from "../http/test-app-helpers";
import { asTestFetch } from "../providers/test-helpers";
import { setupTestConfigDir } from "../test-config-dir";
import { McpClientManager } from "./mcp-client-manager";
import {
  type McpOAuthGrant,
  McpServerOAuthProvider,
  readMcpOAuthGrant,
} from "./mcp-oauth";
import { startOAuthProtectedMcpServer } from "./mcp-oauth-test-fixture";
import { McpService } from "./mcp-service";

const dns: {
  lookup(hostname: string, options: LookupAllOptions): Promise<LookupAddress[]>;
} = dnsModule;

const ACCESS_TOKEN = "fake-access-token";

const CALLBACK_BASE_URL = "http://127.0.0.1:4310";

const remote = startOAuthProtectedMcpServer();

afterAll(async () => {
  await remote.stop();
});

describe("MCP pending browser flow", () => {
  setupTestConfigDir("nakama-mcp-pending-");
  test.each(["initial", "reauthorization", "without-origin"])(
    "a pre-upgrade %s tab completes once",
    async (flow) => {
      const db = createInMemoryDatabaseAdapter();
      const manager = new McpClientManager();
      const service = new McpService(db, manager);

      const created = await service.createServer(
        {
          config: { url: remote.url },
          name: "pre-upgrade",
          transport: "http",
        },
        { callbackBaseUrl: CALLBACK_BASE_URL }
      );

      const stored = await db.getMcpServer(created.server.id);
      const grant = readMcpOAuthGrant(stored?.config);

      if (!(stored && grant)) {
        throw new Error("Expected a pending grant");
      }

      if (flow === "reauthorization") {
        grant.tokens = {
          access_token: "expired-before-upgrade",
          token_type: "Bearer",
        };
      }

      if (flow === "without-origin") {
        delete grant.callbackBaseUrl;
      }

      delete grant.authorizationUrl;
      delete grant.authorizationStartedAt;
      await db.upsertMcpServer({
        ...stored,
        config: { oauth: grant, url: remote.url },
      });
      const url = z.string().parse(created.authorizationUrl);
      const state = z.string().parse(new URL(url).searchParams.get("state"));
      const code = remote.issueCode(url);

      const { app } = createMinimalHonoApp({
        databaseAdapter: db,
        mcpService: new McpService(db, manager),
      });

      const callback = (value: string) =>
        app.fetch(
          new Request(
            `${CALLBACK_BASE_URL}/v1/mcp/oauth/callback/${created.server.id}?${new URLSearchParams({ code, state: value })}`
          )
        );

      const before = remote.tokenRequests.length;

      try {
        expect((await callback("wrong-state")).status).toBe(400);
        expect(remote.tokenRequests.length).toBe(before);
        expect((await callback(state)).status).toBe(200);
        expect((await callback(state)).status).toBe(400);
        expect(remote.tokenRequests.length - before).toBe(1);

        const completed = readMcpOAuthGrant(
          (await db.getMcpServer(created.server.id))?.config
        );

        expect(completed?.tokens?.access_token).toBe(ACCESS_TOKEN);
        expect(completed?.state).toBeUndefined();
        expect(completed?.codeVerifier).toBeUndefined();
      } finally {
        await manager.disconnectAll();
      }
    }
  );

  test.each(["authorizationUrl", "authorizationStartedAt"] as const)(
    "a grant missing only %s cannot bypass expiry as a legacy grant",
    (field) => {
      const grant: McpOAuthGrant = {
        authorizationStartedAt: Date.now(),
        authorizationUrl: "https://auth.example.com/authorize",
        callbackBaseUrl: CALLBACK_BASE_URL,
        clientInformation: {
          client_id: "client",
          redirect_uris: [`${CALLBACK_BASE_URL}/v1/mcp/oauth/callback/partial`],
        },
        codeVerifier: "verifier",
        state: "state",
      };

      delete grant[field];

      const provider = new McpServerOAuthProvider(
        "partial",
        CALLBACK_BASE_URL,
        grant,
        async () => {}
      );

      expect(provider.matchesPendingState("state")).toBe(false);
    }
  );

  test("DNS expiry releases the OAuth lock for queued update and delete", async () => {
    const db = createInMemoryDatabaseAdapter();
    const manager = new McpClientManager();
    const service = new McpService(db, manager);

    const created = await service.createServer({
      config: { url: "https://stalled.invalid/mcp" },
      connect: false,
      name: "dns-deadline",
      transport: "http",
    });

    const stored = await db.getMcpServer(created.server.id);

    if (!stored) {
      throw new Error("Expected a stored server");
    }

    await db.upsertMcpServer({
      ...stored,
      config: { oauth: {}, url: "https://stalled.invalid/mcp" },
    });
    const entered = Promise.withResolvers<void>();
    const lookup = Promise.withResolvers<LookupAddress[]>();
    const deadline = new AbortController();
    const realTimeout = AbortSignal.timeout;

    using dnsSpy = spyOn(dns, "lookup").mockImplementation(() => {
      entered.resolve();

      return lookup.promise;
    });

    using timeoutSpy = spyOn(AbortSignal, "timeout").mockImplementation((ms) =>
      ms === 5000 ? deadline.signal : realTimeout(ms)
    );

    using fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      asTestFetch(async () => {
        throw new Error("HTTP must not start after DNS abort");
      })
    );

    const connect = service.connectServer(created.server.id, {
      callbackBaseUrl: CALLBACK_BASE_URL,
    });

    await entered.promise;
    const update = service.updateServer(created.server.id, { name: "updated" });
    const remove = service.deleteServer(created.server.id);
    const settled = Promise.allSettled([connect, update, remove]);
    let dnsReleased = false;

    const releaseLookup = () => {
      dnsReleased = true;
      lookup.resolve([{ address: "127.0.0.1", family: 4 }]);
    };

    // Release stalled DNS only if the regression would otherwise hang cleanup.
    const guard = setTimeout(releaseLookup, 5000);

    try {
      deadline.abort(new DOMException("DNS timed out", "TimeoutError"));
      const results = await settled;
      expect(dnsReleased).toBe(false);
      expect(results.map((result) => result.status)).toEqual([
        "rejected",
        "fulfilled",
        "fulfilled",
      ]);
      expect(await db.getMcpServer(created.server.id)).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(dnsSpy).toHaveBeenCalled();
      expect(timeoutSpy).toHaveBeenCalled();
    } finally {
      clearTimeout(guard);
      releaseLookup();
      await settled;
      await manager.disconnectAll();
    }
  }, 10_000);

  test("reuses a persisted pending flow after the service is recreated", async () => {
    const db = createInMemoryDatabaseAdapter();
    const manager = new McpClientManager();
    const service = new McpService(db, manager);

    const created = await service.createServer(
      {
        config: { url: remote.url },
        name: "restart-pending",
        transport: "http",
      },
      { callbackBaseUrl: CALLBACK_BASE_URL }
    );

    const before = readMcpOAuthGrant(
      (await db.getMcpServer(created.server.id))?.config
    );

    const restarted = new McpService(db, manager);

    const retried = await restarted.connectServer(created.server.id, {
      callbackBaseUrl: CALLBACK_BASE_URL,
    });

    expect(retried.authorizationUrl).toBe(created.authorizationUrl);
    expect(
      readMcpOAuthGrant((await db.getMcpServer(created.server.id))?.config)
    ).toEqual(before);
    expect(retried.server.config).not.toHaveProperty("oauth");
    await manager.disconnectAll();
  });

  test("expires a pending flow at ten minutes and keeps concurrent retries paired", async () => {
    const now = Date.now();
    using clock = spyOn(Date, "now").mockReturnValue(now);
    const db = createInMemoryDatabaseAdapter();
    const manager = new McpClientManager();
    const service = new McpService(db, manager);

    const created = await service.createServer(
      {
        config: { url: remote.url },
        name: "expiring-flow",
        transport: "http",
      },
      { callbackBaseUrl: CALLBACK_BASE_URL }
    );

    const firstUrl = z.string().parse(created.authorizationUrl);
    clock.mockReturnValue(now + 10 * 60_000 - 1);
    expect(
      (
        await service.connectServer(created.server.id, {
          callbackBaseUrl: CALLBACK_BASE_URL,
        })
      ).authorizationUrl
    ).toBe(firstUrl);
    clock.mockReturnValue(now + 10 * 60_000);

    const oldState = z
      .string()
      .parse(new URL(firstUrl).searchParams.get("state"));

    const results = await Promise.all(
      [0, 1].map(() =>
        service.connectServer(created.server.id, {
          callbackBaseUrl: CALLBACK_BASE_URL,
        })
      )
    );

    const nextUrl = z.string().parse(results[0].authorizationUrl);
    expect(nextUrl).not.toBe(firstUrl);
    expect(results[1].authorizationUrl).toBe(nextUrl);
    await expect(
      service.completeOAuth(created.server.id, {
        callbackBaseUrl: CALLBACK_BASE_URL,
        code: "expired",
        state: oldState,
      })
    ).rejects.toMatchObject({ status: 400 });

    const completed = await service.completeOAuth(created.server.id, {
      callbackBaseUrl: CALLBACK_BASE_URL,
      code: remote.issueCode(nextUrl),
      state: z.string().parse(new URL(nextUrl).searchParams.get("state")),
    });

    expect(completed.server.status).toBe("connected");
    await manager.disconnectAll();
  });

  test.each(["legacy", "origin", "client"])(
    "restarts a %s pending flow safely",
    async (reason) => {
      const db = createInMemoryDatabaseAdapter();
      const manager = new McpClientManager();
      const service = new McpService(db, manager);

      const created = await service.createServer(
        {
          config: { url: remote.url },
          name: "changed-pending",
          transport: "http",
        },
        { callbackBaseUrl: CALLBACK_BASE_URL }
      );

      const stored = await db.getMcpServer(created.server.id);
      const grant = readMcpOAuthGrant(stored?.config);

      if (!(stored && grant)) {
        throw new Error("Expected pending flow");
      }

      if (reason === "legacy" || reason === "client") {
        if (reason === "legacy") {
          delete grant.authorizationUrl;
          delete grant.authorizationStartedAt;
        } else {
          delete grant.clientInformation;
        }

        await db.upsertMcpServer({
          ...stored,
          config: { oauth: grant, url: remote.url },
        });
      }

      const callbackBaseUrl =
        reason === "origin" ? "https://new.example.com" : CALLBACK_BASE_URL;

      const retried = await service.connectServer(created.server.id, {
        callbackBaseUrl,
      });

      const nextUrl = z.string().parse(retried.authorizationUrl);
      expect(nextUrl).not.toBe(created.authorizationUrl);
      expect(new URL(nextUrl).searchParams.get("redirect_uri")).toBe(
        `${callbackBaseUrl}/v1/mcp/oauth/callback/${created.server.id}`
      );

      const completed = await service.completeOAuth(created.server.id, {
        callbackBaseUrl,
        code: remote.issueCode(nextUrl),
        state: z.string().parse(new URL(nextUrl).searchParams.get("state")),
      });

      expect(completed.server.status).toBe("connected");
      await manager.disconnectAll();
    }
  );

  test("a connect during callback exchange cannot replace the completed grant", async () => {
    const db = createInMemoryDatabaseAdapter();
    const manager = new McpClientManager();
    const service = new McpService(db, manager);

    const created = await service.createServer(
      {
        config: { url: remote.url },
        name: "callback-retry",
        transport: "http",
      },
      { callbackBaseUrl: CALLBACK_BASE_URL }
    );

    const url = z.string().parse(created.authorizationUrl);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const save = db.upsertMcpServer.bind(db);
    let paused = false;

    using gate = spyOn(db, "upsertMcpServer").mockImplementation(
      async (record) => {
        if (!paused && readMcpOAuthGrant(record.config)?.tokens) {
          paused = true;
          entered.resolve();
          await release.promise;
        }

        return save(record);
      }
    );

    try {
      const callback = service.completeOAuth(created.server.id, {
        callbackBaseUrl: CALLBACK_BASE_URL,
        code: remote.issueCode(url),
        state: z.string().parse(new URL(url).searchParams.get("state")),
      });

      await entered.promise;

      const retry = service.connectServer(created.server.id, {
        callbackBaseUrl: CALLBACK_BASE_URL,
      });

      release.resolve();
      const results = await Promise.all([callback, retry]);
      expect(results.map((r) => r.server.status)).toEqual([
        "connected",
        "connected",
      ]);
      expect(results[1].authorizationUrl).toBeUndefined();

      const grant = readMcpOAuthGrant(
        (await db.getMcpServer(created.server.id))?.config
      );

      expect(grant?.tokens?.access_token).toBe(ACCESS_TOKEN);
      expect(grant?.state).toBeUndefined();
      expect(grant?.authorizationUrl).toBeUndefined();
      expect(gate).toHaveBeenCalled();
    } finally {
      release.resolve();
      await manager.disconnectAll();
    }
  });

  test.each(["all", "client", "tokens", "verifier"] as const)(
    "%s credential invalidation drops the reusable browser flow",
    async (scope) => {
      const provider = new McpServerOAuthProvider(
        "pending",
        CALLBACK_BASE_URL,
        undefined,
        async () => {}
      );

      await provider.saveClientInformation({ client_id: "client" });
      const state = await provider.state();
      await provider.saveCodeVerifier("verifier");
      await provider.redirectToAuthorization(
        new URL("https://auth.example.com/authorize")
      );
      expect(provider.pendingAuthorizationUrl()).toBeTruthy();
      await provider.invalidateCredentials(scope);
      expect(provider.pendingAuthorizationUrl()).toBeUndefined();
      expect(provider.matchesPendingState(state)).toBe(false);
    }
  );

  test("resumes reauthorization after token refresh fails", async () => {
    const db = createInMemoryDatabaseAdapter();
    const manager = new McpClientManager();
    const service = new McpService(db, manager);

    const created = await service.createServer({
      config: { url: remote.url },
      connect: false,
      name: "expired-tokens",
      transport: "http",
    });

    const stored = await db.getMcpServer(created.server.id);

    if (!stored) {
      throw new Error("Expected stored server");
    }

    await db.upsertMcpServer({
      ...stored,
      config: {
        oauth: {
          tokens: {
            access_token: "expired-token",
            refresh_token: "unavailable-refresh-token",
            token_type: "Bearer",
          },
        },
        url: remote.url,
      },
    });

    try {
      const first = await service.connectServer(created.server.id, {
        callbackBaseUrl: CALLBACK_BASE_URL,
      });

      const url = z.string().parse(first.authorizationUrl);

      // One failed refresh must not cost a refresh token that may still work.
      expect(
        readMcpOAuthGrant((await db.getMcpServer(created.server.id))?.config)
          ?.tokens?.refresh_token
      ).toBe("unavailable-refresh-token");

      const retry = await service.connectServer(created.server.id, {
        callbackBaseUrl: CALLBACK_BASE_URL,
      });

      const completed = await service.completeOAuth(created.server.id, {
        callbackBaseUrl: CALLBACK_BASE_URL,
        code: remote.issueCode(url),
        state: z.string().parse(new URL(url).searchParams.get("state")),
      });

      expect(completed.server.status).toBe("connected");
      expect(retry.authorizationUrl).toBe(url);
    } finally {
      await manager.disconnectAll();
    }
  });
});
