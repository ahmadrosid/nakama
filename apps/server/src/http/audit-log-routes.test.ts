import { describe, expect, test } from "bun:test";
import { setupTestConfigDir } from "../test-config-dir";
import { describeAuditEvent } from "./audit-log";
import { createMinimalHonoApp } from "./test-app-helpers";

setupTestConfigDir("nakama-audit-log-routes-test-");

describe("audit event route table coverage", () => {
  test("covers security mutations registered in the real route table", () => {
    const { app } = createMinimalHonoApp();

    const routes = app.routes.map((route) => ({
      method: route.method,
      path: route.path,
    }));

    const expected = [
      [
        "POST",
        "/v1/auth/setup/import/restore",
        "/v1/auth/setup/import/restore",
      ],
      ["POST", "/v1/auth/active-org", "/v1/auth/active-org"],
      [
        "POST",
        "/v1/platform/plugins/releases",
        "/v1/platform/plugins/releases",
      ],
      [
        "DELETE",
        "/v1/platform/orgs/:orgId/permanent",
        "/v1/platform/orgs/org_1/permanent",
      ],
      ["DELETE", "/v1/platform/users/:userId", "/v1/platform/users/user_1"],
      ["POST", "/v1/profiles/:profileId/tools", "/v1/profiles/profile_1/tools"],
      [
        "DELETE",
        "/v1/profiles/:profileId/tools/:toolId",
        "/v1/profiles/profile_1/tools/tool_1",
      ],
      [
        "POST",
        "/v1/profiles/:profileId/mcp-servers",
        "/v1/profiles/profile_1/mcp-servers",
      ],
      [
        "DELETE",
        "/v1/profiles/:profileId/mcp-servers/:serverId",
        "/v1/profiles/profile_1/mcp-servers/server_1",
      ],
      [
        "POST",
        "/v1/profiles/:profileId/skills",
        "/v1/profiles/profile_1/skills",
      ],
      [
        "DELETE",
        "/v1/profiles/:profileId/skills/:skillId",
        "/v1/profiles/profile_1/skills/skill_1",
      ],
      [
        "PUT",
        "/v1/profiles/:profileId/soul/files/:fileKey",
        "/v1/profiles/profile_1/soul/files/USER.md",
      ],
      [
        "POST",
        "/v1/auth/password-reset/request",
        "/v1/auth/password-reset/request",
      ],
      [
        "POST",
        "/v1/auth/password-reset/complete",
        "/v1/auth/password-reset/complete",
      ],
      ["POST", "/v1/auth/mfa/totp/verify", "/v1/auth/mfa/totp/verify"],
      ["POST", "/v1/auth/mfa/disable", "/v1/auth/mfa/disable"],
      ["POST", "/v1/auth/mfa/passkey/verify", "/v1/auth/mfa/passkey/verify"],
      ["POST", "/v1/auth/mfa/passkey/disable", "/v1/auth/mfa/passkey/disable"],
      ["POST", "/v1/auth/mfa/backup-codes", "/v1/auth/mfa/backup-codes"],
      ["DELETE", "/v1/auth/sessions/:sessionId", "/v1/auth/sessions/session_1"],
      ["DELETE", "/v1/sessions/:sessionId", "/v1/sessions/session_1"],
      [
        "POST",
        "/v1/sessions/:sessionId/browser/:control{takeover|handoff|login}",
        "/v1/sessions/session_1/browser/login",
      ],
      [
        "DELETE",
        "/v1/auth/users/:userId/sessions",
        "/v1/auth/users/user_1/sessions",
      ],
      // Extended coverage: one representative per new route class.
      ["POST", "/v1/skills", "/v1/skills"],
      ["PATCH", "/v1/skills/:skillId", "/v1/skills/skill_1"],
      ["DELETE", "/v1/skills/:skillId", "/v1/skills/skill_1"],
      ["POST", "/v1/skills/install", "/v1/skills/install"],
      ["POST", "/v1/skills/sync", "/v1/skills/sync"],
      [
        "POST",
        "/v1/skills/:skillId/python-packages",
        "/v1/skills/skill_1/python-packages",
      ],
      [
        "POST",
        "/v1/skills/:skillId/versions/:versionId/restore",
        "/v1/skills/skill_1/versions/v1/restore",
      ],
      ["POST", "/v1/tools", "/v1/tools"],
      ["DELETE", "/v1/tools/:toolId", "/v1/tools/tool_1"],
      ["PUT", "/v1/tools/:toolId/credentials", "/v1/tools/tool_1/credentials"],
      ["POST", "/v1/tools/:toolId/run", "/v1/tools/tool_1/run"],
      ["POST", "/v1/tool-setups/:setupId", "/v1/tool-setups/setup_1"],
      ["DELETE", "/v1/tool-setups/:setupId", "/v1/tool-setups/setup_1"],
      ["POST", "/v1/automations", "/v1/automations"],
      ["PUT", "/v1/automations/:automationId", "/v1/automations/a_1"],
      ["DELETE", "/v1/automations/:automationId", "/v1/automations/a_1"],
      ["POST", "/v1/automations/:automationId/run", "/v1/automations/a_1/run"],
      [
        "POST",
        "/v1/internal/automations/:automationId/run",
        "/v1/internal/automations/a_1/run",
      ],
      ["POST", "/v1/mcp/servers", "/v1/mcp/servers"],
      ["PATCH", "/v1/mcp/servers/:serverId", "/v1/mcp/servers/server_1"],
      ["DELETE", "/v1/mcp/servers/:serverId", "/v1/mcp/servers/server_1"],
      [
        "POST",
        "/v1/mcp/servers/:serverId/connect",
        "/v1/mcp/servers/server_1/connect",
      ],
      [
        "POST",
        "/v1/mcp/servers/:serverId/sync",
        "/v1/mcp/servers/server_1/sync",
      ],
      ["POST", "/v1/plugins/:pluginId/install", "/v1/plugins/p_1/install"],
      ["POST", "/v1/plugins/:pluginId/uninstall", "/v1/plugins/p_1/uninstall"],
      ["POST", "/v1/plugins/:pluginId/enable", "/v1/plugins/p_1/enable"],
      ["POST", "/v1/plugins/:pluginId/disable", "/v1/plugins/p_1/disable"],
      ["POST", "/v1/plugins/:pluginId/update", "/v1/plugins/p_1/update"],
      [
        "POST",
        "/v1/plugins/:pluginId/retained-data/delete",
        "/v1/plugins/p_1/retained-data/delete",
      ],
      [
        "POST",
        "/v1/plugins/official/:pluginId/install",
        "/v1/plugins/official/p_1/install",
      ],
      [
        "POST",
        "/v1/plugins/official/:pluginId/reinstall",
        "/v1/plugins/official/p_1/reinstall",
      ],
      [
        "POST",
        "/v1/platform/plugins/install-local",
        "/v1/platform/plugins/install-local",
      ],
      [
        "DELETE",
        "/v1/platform/plugins/releases/:pluginId/:version",
        "/v1/platform/plugins/releases/p_1/1.0.0",
      ],
      [
        "POST",
        "/v1/notification-destinations",
        "/v1/notification-destinations",
      ],
      [
        "PUT",
        "/v1/notification-destinations/:destinationId",
        "/v1/notification-destinations/d_1",
      ],
      [
        "DELETE",
        "/v1/notification-destinations/:destinationId",
        "/v1/notification-destinations/d_1",
      ],
      [
        "POST",
        "/v1/notification-destinations/:destinationId/rotate-key",
        "/v1/notification-destinations/d_1/rotate-key",
      ],
      ["PUT", "/v1/orgs/:orgId/memory", "/v1/orgs/org_1/memory"],
      ["POST", "/v1/orgs/:orgId/memory/facts", "/v1/orgs/org_1/memory/facts"],
      ["POST", "/v1/orgs/:orgId/memory/pin", "/v1/orgs/org_1/memory/pin"],
      ["POST", "/v1/orgs/:orgId/memory/unpin", "/v1/orgs/org_1/memory/unpin"],
      [
        "POST",
        "/v1/orgs/:orgId/memory/archive",
        "/v1/orgs/org_1/memory/archive",
      ],
      [
        "POST",
        "/v1/orgs/:orgId/memory/history/undo",
        "/v1/orgs/org_1/memory/history/undo",
      ],
      [
        "POST",
        "/v1/orgs/:orgId/memory/history/:revisionId/restore",
        "/v1/orgs/org_1/memory/history/r_1/restore",
      ],
      [
        "POST",
        "/v1/orgs/:orgId/memory/proposals/:proposalId/approve",
        "/v1/orgs/org_1/memory/proposals/p_1/approve",
      ],
      [
        "POST",
        "/v1/orgs/:orgId/memory/proposals/:proposalId/reject",
        "/v1/orgs/org_1/memory/proposals/p_1/reject",
      ],
      ["POST", "/v1/orgs/:orgId/curator/run", "/v1/orgs/org_1/curator/run"],
      [
        "POST",
        "/v1/internal/curator/orgs/:orgId/run",
        "/v1/internal/curator/orgs/org_1/run",
      ],
      [
        "POST",
        "/v1/orgs/:orgId/shared-resources",
        "/v1/orgs/org_1/shared-resources",
      ],
      [
        "DELETE",
        "/v1/orgs/:orgId/shared-resources/:publicationId",
        "/v1/orgs/org_1/shared-resources/pub_1",
      ],
      [
        "POST",
        "/v1/orgs/:orgId/skill-proposals/:proposalId/approve",
        "/v1/orgs/org_1/skill-proposals/p_1/approve",
      ],
      [
        "POST",
        "/v1/orgs/:orgId/skill-proposals/:proposalId/reject",
        "/v1/orgs/org_1/skill-proposals/p_1/reject",
      ],
      [
        "POST",
        "/v1/orgs/:orgId/skill-suggestions/:suggestionId/apply",
        "/v1/orgs/org_1/skill-suggestions/s_1/apply",
      ],
      ["POST", "/v1/orgs/:orgId/teams", "/v1/orgs/org_1/teams"],
      [
        "POST",
        "/v1/orgs/:orgId/knowledge-base",
        "/v1/orgs/org_1/knowledge-base",
      ],
      [
        "DELETE",
        "/v1/orgs/:orgId/knowledge-base/:documentId",
        "/v1/orgs/org_1/knowledge-base/doc_1",
      ],
      [
        "PUT",
        "/v1/profiles/:profileId/avatar",
        "/v1/profiles/profile_1/avatar",
      ],
      [
        "POST",
        "/v1/profiles/:profileId/soul/init",
        "/v1/profiles/profile_1/soul/init",
      ],
      [
        "POST",
        "/v1/profiles/:profileId/knowledge-base",
        "/v1/profiles/profile_1/knowledge-base",
      ],
      [
        "POST",
        "/v1/profiles/:profileId/knowledge-base/import-zip",
        "/v1/profiles/profile_1/knowledge-base/import-zip",
      ],
      [
        "DELETE",
        "/v1/profiles/:profileId/artifacts",
        "/v1/profiles/profile_1/artifacts",
      ],
      [
        "POST",
        "/v1/profiles/:profileId/artifacts/shares",
        "/v1/profiles/profile_1/artifacts/shares",
      ],
      [
        "DELETE",
        "/v1/profiles/:profileId/artifacts/shares/:shareId",
        "/v1/profiles/profile_1/artifacts/shares/share_1",
      ],
      ["POST", "/v1/sessions", "/v1/sessions"],
      ["PATCH", "/v1/sessions/:sessionId", "/v1/sessions/session_1"],
      [
        "POST",
        "/v1/sessions/:sessionId/branch",
        "/v1/sessions/session_1/branch",
      ],
      [
        "POST",
        "/v1/sessions/:sessionId/compact",
        "/v1/sessions/session_1/compact",
      ],
      ["POST", "/v1/sessions/:sessionId/stop", "/v1/sessions/session_1/stop"],
      [
        "DELETE",
        "/v1/sessions/:sessionId/browser",
        "/v1/sessions/session_1/browser",
      ],
      [
        "PUT",
        "/v1/sessions/:sessionId/acp-settings/:configId",
        "/v1/sessions/session_1/acp-settings/c_1",
      ],
      [
        "PUT",
        "/v1/profiles/:profileId/acp-settings/:configId",
        "/v1/profiles/profile_1/acp-settings/c_1",
      ],
      [
        "POST",
        "/v1/settings/telegram/handshake",
        "/v1/settings/telegram/handshake",
      ],
      [
        "POST",
        "/v1/settings/telegram/pairing/:pairingId/apply",
        "/v1/settings/telegram/pairing/pairing_1/apply",
      ],
      [
        "POST",
        "/v1/settings/whatsapp/pairing-code",
        "/v1/settings/whatsapp/pairing-code",
      ],
      [
        "POST",
        "/v1/settings/agent-browser/install",
        "/v1/settings/agent-browser/install",
      ],
      [
        "POST",
        "/v1/providers/:providerId/default",
        "/v1/providers/provider_1/default",
      ],
      [
        "PUT",
        "/v1/providers/:providerId/secret",
        "/v1/providers/provider_1/secret",
      ],
      [
        "POST",
        "/v1/xai-oauth/device/complete",
        "/v1/xai-oauth/device/complete",
      ],
      [
        "POST",
        "/v1/chatgpt-oauth/device/complete",
        "/v1/chatgpt-oauth/device/complete",
      ],
      ["POST", "/v1/system/upgrade", "/v1/system/upgrade"],
      ["PUT", "/v1/system/web-public-url", "/v1/system/web-public-url"],
      ["POST", "/v1/workers/:name/clear-logs", "/v1/workers/w_1/clear-logs"],
    ] as const;

    for (const [method, routePath, samplePath] of expected) {
      expect(routes).toContainEqual({ method, path: routePath });
      expect(describeAuditEvent(method, samplePath)).not.toBeNull();
    }
  });
});
