import { expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../../test-config-dir";
import type { ServerOptions } from "../context";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  type AppFetch,
  loginPlatformAdminSession,
  loginUserSession,
  seedOrgAdmin,
} from "../test-session-helpers";
import type { AppEnv } from "../types";
import { registerAuditEventRoutes } from "./audit-events";

setupTestConfigDir("nakama-audit-events-route-test-");

test("export reads one batch per pull and stops when the download is cancelled", async () => {
  const databaseAdapter = createInMemoryDatabaseAdapter();

  await databaseAdapter.createAuditEvent({
    action: "auth.login",
    createdAt: "2026-09-12T01:00:00.000Z",
    id: "audit_1",
    resourceType: "user",
  });

  const [batch = []] = await Array.fromAsync(
    databaseAdapter.exportAuditEvents()
  );

  let pulled = 0;
  let finished = false;

  databaseAdapter.exportAuditEvents = async function* () {
    try {
      for (let index = 0; index < 1000; index += 1) {
        pulled += 1;
        yield batch;
      }
    } finally {
      finished = true;
    }
  };

  const app = new OpenAPIHono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("auth", {
      isPlatformAdmin: true,
      mode: "local-token",
      user: { email: "admin@example.com", id: "user_admin" },
    });
    await next();
  });

  // SAFETY: the export route reads only `databaseAdapter` from the options.
  registerAuditEventRoutes(app, { databaseAdapter } as ServerOptions);

  const response = await app.request("/v1/platform/audit-events/export");
  const reader = response.body?.getReader();
  const first = await reader?.read();

  expect(JSON.parse(new TextDecoder().decode(first?.value)).id).toBe("audit_1");

  await reader?.cancel();

  expect(finished).toBe(true);
  expect(pulled).toBeLessThan(10);
});

test("platform admin updates retention, previews prunable rows, and prunes", async () => {
  const { app, authService, databaseAdapter } = createMinimalHonoApp();
  const fetchApp: AppFetch = app;

  const dayMs = 24 * 60 * 60 * 1000;
  const oldTimestamp = new Date(Date.now() - 150 * dayMs).toISOString();

  await databaseAdapter.createAuditEvent({
    action: "auth.login",
    createdAt: oldTimestamp,
    id: "audit_old_route_1",
    resourceType: "user",
  });

  const session = await loginPlatformAdminSession(
    fetchApp,
    authService,
    databaseAdapter
  );

  const initialStats = await app.fetch(
    new Request("http://localhost:4310/v1/platform/audit-events/stats", {
      headers: session.headers(),
    })
  );

  expect(initialStats.status).toBe(200);
  expect(await initialStats.json()).toMatchObject({ retentionDays: 365 });

  const preview90 = await app.fetch(
    new Request(
      "http://localhost:4310/v1/platform/audit-events/prunable?days=90",
      { headers: session.headers() }
    )
  );

  expect(preview90.status).toBe(200);
  expect(await preview90.json()).toEqual({ days: 90, rows: 1 });

  const invalidPreview = await app.fetch(
    new Request(
      "http://localhost:4310/v1/platform/audit-events/prunable?days=-1",
      { headers: session.headers() }
    )
  );

  expect(invalidPreview.status).toBe(400);

  // Below the 90-day minimum, so an admin cannot wipe recent history.
  const update30 = await app.fetch(
    new Request("http://localhost:4310/v1/platform/audit-events/retention", {
      body: JSON.stringify({ retentionDays: 30 }),
      headers: {
        ...session.headers({ "X-CSRF-Token": session.csrfToken }),
        "Content-Type": "application/json",
      },
      method: "PUT",
    })
  );

  expect(update30.status).toBe(400);

  const update90 = await app.fetch(
    new Request("http://localhost:4310/v1/platform/audit-events/retention", {
      body: JSON.stringify({ retentionDays: 90 }),
      headers: {
        ...session.headers({ "X-CSRF-Token": session.csrfToken }),
        "Content-Type": "application/json",
      },
      method: "PUT",
    })
  );

  expect(update90.status).toBe(200);
  expect(await update90.json()).toEqual({ retentionDays: 90 });

  const pruned = await app.fetch(
    new Request("http://localhost:4310/v1/platform/audit-events/prune", {
      headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
      method: "POST",
    })
  );

  expect(pruned.status).toBe(200);
  expect(await pruned.json()).toEqual({
    deleted: 1,
    hasMore: false,
    retentionDays: 90,
  });

  const update0 = await app.fetch(
    new Request("http://localhost:4310/v1/platform/audit-events/retention", {
      body: JSON.stringify({ retentionDays: 0 }),
      headers: {
        ...session.headers({ "X-CSRF-Token": session.csrfToken }),
        "Content-Type": "application/json",
      },
      method: "PUT",
    })
  );

  expect(update0.status).toBe(200);

  const pruneWhenOff = await app.fetch(
    new Request("http://localhost:4310/v1/platform/audit-events/prune", {
      headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
      method: "POST",
    })
  );

  expect(pruneWhenOff.status).toBe(400);
});

test("rejects non-platform-admins on audit retention and prune routes", async () => {
  const { app, databaseAdapter } = createMinimalHonoApp();
  const fetchApp: AppFetch = app;
  const orgAdmin = await seedOrgAdmin(databaseAdapter);

  const session = await loginUserSession(
    fetchApp,
    orgAdmin.email,
    orgAdmin.password,
    orgAdmin.orgId
  );

  const prunable = await app.fetch(
    new Request("http://localhost:4310/v1/platform/audit-events/prunable", {
      headers: session.headers(),
    })
  );

  expect(prunable.status).toBe(403);

  const update = await app.fetch(
    new Request("http://localhost:4310/v1/platform/audit-events/retention", {
      body: JSON.stringify({ retentionDays: 30 }),
      headers: {
        ...session.headers({ "X-CSRF-Token": session.csrfToken }),
        "Content-Type": "application/json",
      },
      method: "PUT",
    })
  );

  expect(update.status).toBe(403);

  const prune = await app.fetch(
    new Request("http://localhost:4310/v1/platform/audit-events/prune", {
      headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
      method: "POST",
    })
  );

  expect(prune.status).toBe(403);
});
