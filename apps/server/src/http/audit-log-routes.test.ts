import { describe, expect, test } from "bun:test";
import { setupTestConfigDir } from "../test-config-dir";
import { AUDIT_ROUTES, describeAuditEvent } from "./audit-log-routes";
import type { ServerOptions } from "./context";
import { createMinimalHonoApp } from "./test-app-helpers";

setupTestConfigDir("nakama-audit-log-routes-test-");

// Mutating routes left out of AUDIT_ROUTES on purpose: hot paths, previews,
// connection tests, client state, and ephemeral controls.
const UNAUDITED_ROUTES = new Set([
  "DELETE /v1/push/subscription",
  "PATCH /v1/profiles/:profileId/workspace/rename",
  "POST /v1/acp-mcp/:token",
  "POST /v1/audio/transcribe",
  "POST /v1/auth/mfa/passkey/start",
  "POST /v1/auth/mfa/totp/start",
  "POST /v1/auth/passkey/login/options",
  "POST /v1/auth/setup/import/preview",
  "POST /v1/automations/:automationId/runs/mark-read",
  "POST /v1/automations/draft",
  "POST /v1/channels/teams/:profileId/messages",
  "POST /v1/chatgpt-oauth/device/start",
  "POST /v1/images/generate",
  "POST /v1/llm/chat",
  "POST /v1/llm/text",
  "POST /v1/mcp/servers/test",
  "POST /v1/meet/actions/:actionKey",
  "POST /v1/meet/extension/disconnect",
  "POST /v1/meet/extension/leave",
  "POST /v1/meet/extension/pair",
  "POST /v1/meet/extension/start",
  "POST /v1/models/discover",
  "POST /v1/notify/:destinationId",
  "POST /v1/orgs/:orgId/memory/search",
  "POST /v1/platform/audit-events/prune",
  "POST /v1/platform/audit-events/verify",
  "POST /v1/platform/data/import/preview",
  "POST /v1/platform/plugins/local-file",
  "POST /v1/platform/plugins/preview-local",
  "POST /v1/platform/plugins/releases/preview",
  "POST /v1/plugins/:pluginId/actions/:actionKey",
  "POST /v1/profiles/pack/import/preview",
  "POST /v1/providers/:providerId/check",
  "POST /v1/providers/check-key",
  "POST /v1/sessions/:sessionId/messages",
  "POST /v1/settings/email/test",
  "POST /v1/settings/error-tracking/test",
  "POST /v1/skills/install/preview",
  "POST /v1/tools/:toolId/params/suggest",
  "POST /v1/user/context/init",
  "POST /v1/user/setup-checklist",
  "POST /v1/xai-oauth/device/start",
  "PUT /v1/profiles/:profileId/workspace/pins",
  "PUT /v1/push/presence",
  "PUT /v1/push/subscription",
  "PUT /v1/sessions/order",
  "PUT /v1/user/context",
  "POST /v1/llm/token",
  "PUT /v1/rail-pins/:itemId",
  "DELETE /v1/rail-pins/:itemId",
  "POST /v1/agent-groups/:groupId/sessions/:sessionId/messages",
  "POST /v1/agent-groups/:groupId/sessions/:sessionId/stop",
  "POST /v1/agent-groups/:groupId/sessions/:sessionId/threads/:messageId/messages",
  "POST /v1/agent-groups/:groupId/sessions/:sessionId/threads/:messageId/stop",
  // Known gaps: no rule yet. Remove an entry when its rule lands.
  "POST /v1/workers/:name/:action{start|stop|restart|disconnect}",
  "PUT /v1/profiles/:profileId/knowledge-base/shared/:documentId",
  "DELETE /v1/profiles/:profileId/knowledge-base/shared/:documentId",
  "POST /v1/profiles/:profileId/regression-cases/:caseId/runs",
  "PATCH /v1/profiles/:profileId/regression-cases/:caseId/runs/:runId",
  "POST /v1/agent-groups",
  "PUT /v1/agent-groups/:groupId",
  "DELETE /v1/agent-groups/:groupId",
  "PUT /v1/agent-groups/:groupId/avatar",
  "DELETE /v1/agent-groups/:groupId/avatar",
  "PUT /v1/agent-groups/:groupId/memory",
  "POST /v1/agent-groups/:groupId/sessions",
  "PATCH /v1/agent-groups/:groupId/sessions/:sessionId",
  "DELETE /v1/agent-groups/:groupId/sessions/:sessionId",
  "POST /v1/orgs/:orgId/shared-agents/:publicationId/instance",
]);

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

    // A new mutating route needs a rule, or an entry in UNAUDITED_ROUTES.
    const missing = [...registered].filter(
      (key) =>
        /^(DELETE|PATCH|POST|PUT) /.test(key) &&
        !(AUDIT_ROUTES.has(key) || UNAUDITED_ROUTES.has(key))
    );

    expect(missing).toEqual([]);
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
