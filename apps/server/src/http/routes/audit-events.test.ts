import { expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import type { ServerOptions } from "../context";
import type { AppEnv } from "../types";
import { registerAuditEventRoutes } from "./audit-events";

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
