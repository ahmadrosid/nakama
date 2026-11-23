import { describe, expect, test } from "bun:test";
import { setupTestConfigDir } from "../test-config-dir";
import { AUDIT_ROUTES, describeAuditEvent } from "./audit-log-routes";
import type { ServerOptions } from "./context";
import { createMinimalHonoApp } from "./test-app-helpers";

setupTestConfigDir("nakama-audit-log-routes-test-");

describe("audit route table", () => {
  test("every rule names a route the app registers", () => {
    // SAFETY: registration only checks these services exist; no handler runs.
    const { app } = createMinimalHonoApp({
      composioService: {} as NonNullable<ServerOptions["composioService"]>,
      computerAuth: {} as NonNullable<ServerOptions["computerAuth"]>,
    });

    const registered = new Set(
      app.routes.map((route) => `${route.method} ${route.path}`)
    );

    const unregistered = [...AUDIT_ROUTES.keys()].filter(
      (key) => !registered.has(key)
    );

    expect(unregistered).toEqual([]);
  });

  test("fills params into the action, resource, and organization", () => {
    expect(
      describeAuditEvent(
        "POST",
        "/v1/sessions/:sessionId/browser/:control{takeover|handoff|login}",
        "/v1/sessions/s%201/browser/login"
      )
    ).toEqual({
      action: "session.browser_login",
      resourceId: "s 1",
      resourceType: "session",
    });

    expect(
      describeAuditEvent(
        "DELETE",
        "/v1/platform/plugins/releases/:pluginId/:version",
        "/v1/platform/plugins/releases/acme/1.2.0"
      )?.resourceId
    ).toBe("acme@1.2.0");

    expect(
      describeAuditEvent(
        "DELETE",
        "/v1/orgs/:orgId/invites/:inviteId",
        "/v1/orgs/org_1/invites/invite_1"
      )
    ).toMatchObject({ orgId: "org_1", resourceId: "invite_1" });

    expect(
      describeAuditEvent(
        "DELETE",
        "/v1/platform/users/:userId",
        "/v1/platform/users/user_1"
      )
    ).toHaveProperty("orgId", null);

    expect(
      describeAuditEvent("GET", "/v1/skills/:skillId", "/v1/skills/x")
    ).toBeNull();
  });
});
