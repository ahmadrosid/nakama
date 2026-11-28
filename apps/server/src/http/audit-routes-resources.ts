import type { AuditRule } from "./audit-log-routes";

/** Audit rules for profiles, sessions, skills, tools, MCP servers, plugins, automations, and integrations. */
export const RESOURCES_AUDIT_ROUTES: ReadonlyArray<
  readonly [string, AuditRule]
> = [
  ["POST /v1/sessions", ["session.create", "session"]],
  [
    "DELETE /v1/sessions/:sessionId",
    ["session.delete", "session", ":sessionId"],
  ],
  [
    "PATCH /v1/sessions/:sessionId",
    ["session.update", "session", ":sessionId"],
  ],
  [
    "PUT /v1/sessions/:sessionId/acp-settings/:configId",
    ["profile.acp_settings", "profile", ":configId"],
  ],
  [
    "DELETE /v1/sessions/:sessionId/browser",
    ["session.browser_disconnect", "session", ":sessionId"],
  ],
  [
    "POST /v1/sessions/:sessionId/browser/:control{takeover|handoff|login}",
    ["session.browser_:control", "session", ":sessionId"],
  ],
  [
    "POST /v1/sessions/:sessionId/compact",
    ["session.compact", "session", ":sessionId"],
  ],
  [
    "POST /v1/sessions/:sessionId/stop",
    ["session.stop", "session", ":sessionId"],
  ],
  [
    "POST /v1/sessions/:sessionId/branch",
    ["session.branch", "session", ":sessionId"],
  ],
  ["POST /v1/profiles", ["profile.create", "profile"]],
  ["POST /v1/profiles/with-super-nakama", ["profile.create", "profile"]],
  [
    "POST /v1/profiles/:profileId/soul/init",
    ["profile.soul_init", "profile", ":profileId"],
  ],
  [
    "PUT /v1/profiles/:profileId/soul/files/:fileKey",
    ["profile.soul_update", "profile", ":profileId"],
  ],
  [
    "PUT /v1/profiles/:profileId/artifacts/content",
    ["artifact.create", "artifact", ":profileId"],
  ],
  [
    "DELETE /v1/profiles/:profileId/artifacts",
    ["artifact.delete", "artifact", ":profileId"],
  ],
  [
    "POST /v1/profiles/:profileId/knowledge-base",
    ["profile.knowledge_base_create", "knowledge_base", ":profileId"],
  ],
  [
    "POST /v1/profiles/:profileId/knowledge-base/import-zip",
    ["profile.knowledge_base_import", "knowledge_base", ":profileId"],
  ],
  [
    "DELETE /v1/profiles/:profileId/knowledge-base/:documentId",
    ["profile.knowledge_base_delete", "knowledge_base", ":documentId"],
  ],
  [
    "PUT /v1/profiles/:profileId/avatar",
    ["profile.avatar", "profile", ":profileId"],
  ],
  [
    "DELETE /v1/profiles/:profileId/avatar",
    ["profile.avatar", "profile", ":profileId"],
  ],
  [
    "PUT /v1/profiles/:profileId/acp-settings/:configId",
    ["profile.acp_settings", "profile", ":profileId"],
  ],
  ["PUT /v1/profiles/:profileId", ["profile.update", "profile", ":profileId"]],
  [
    "POST /v1/profiles/:profileId/clone",
    ["profile.clone", "profile", ":profileId"],
  ],
  [
    "POST /v1/profiles/:profileId/move",
    ["profile.move", "profile", ":profileId"],
  ],
  [
    "DELETE /v1/profiles/:profileId",
    ["profile.delete", "profile", ":profileId"],
  ],
  [
    "GET /v1/profiles/:profileId/pack/export",
    ["profile.export", "profile", ":profileId"],
  ],
  ["POST /v1/profiles/pack/import", ["profile.import", "profile"]],
  [
    "POST /v1/profiles/:profileId/regression-cases",
    ["regression.create", "regression_case", ":profileId"],
  ],
  [
    "POST /v1/profiles/:profileId/artifacts/shares",
    ["share.create", "share", ":profileId"],
  ],
  [
    "DELETE /v1/profiles/:profileId/artifacts/shares/:shareId",
    ["share.delete", "share", ":shareId"],
  ],
  ["POST /v1/mcp/servers", ["mcp_server.create", "mcp_server"]],
  [
    "POST /v1/mcp/servers/:serverId/connect",
    ["mcp_server.connect", "mcp_server", ":serverId"],
  ],
  [
    "POST /v1/mcp/servers/:serverId/sync",
    ["mcp_server.sync", "mcp_server", ":serverId"],
  ],
  [
    "PATCH /v1/mcp/servers/:serverId",
    ["mcp_server.update", "mcp_server", ":serverId"],
  ],
  [
    "DELETE /v1/mcp/servers/:serverId",
    ["mcp_server.delete", "mcp_server", ":serverId"],
  ],
  [
    "POST /v1/profiles/:profileId/mcp-servers",
    ["profile.mcp_server.create", "mcp_server", ":profileId"],
  ],
  [
    "DELETE /v1/profiles/:profileId/mcp-servers/:serverId",
    ["profile.mcp_server.delete", "mcp_server", ":serverId"],
  ],
  [
    "POST /v1/skills/:skillId/python-packages",
    ["skill.python_packages", "skill", ":skillId"],
  ],
  [
    "POST /v1/skills/:skillId/versions/:versionId/restore",
    ["skill.version_restore", "skill", ":skillId"],
  ],
  ["POST /v1/skills", ["skill.create", "skill"]],
  ["POST /v1/skills/install", ["skill.install", "skill"]],
  ["POST /v1/skills/sync", ["skill.sync", "skill"]],
  ["PATCH /v1/skills/:skillId", ["skill.update", "skill", ":skillId"]],
  ["DELETE /v1/skills/:skillId", ["skill.delete", "skill", ":skillId"]],
  [
    "POST /v1/profiles/:profileId/skills",
    ["profile.skills.create", "skills", ":profileId"],
  ],
  [
    "DELETE /v1/profiles/:profileId/skills/:skillId",
    ["profile.skills.delete", "skills", ":skillId"],
  ],
  [
    "POST /v1/tool-setups/:setupId",
    ["tool_setup.update", "tool_setup", ":setupId"],
  ],
  [
    "DELETE /v1/tool-setups/:setupId",
    ["tool_setup.delete", "tool_setup", ":setupId"],
  ],
  ["POST /v1/tools", ["tool.create", "tool"]],
  [
    "PUT /v1/tools/:toolId/credentials",
    ["tool.credentials_update", "tool", ":toolId"],
  ],
  [
    "DELETE /v1/tools/:toolId/credentials",
    ["tool.credentials_update", "tool", ":toolId"],
  ],
  [
    "POST /v1/tools/:toolId/credentials/use-stored",
    ["tool.credentials_update", "tool", ":toolId"],
  ],
  ["DELETE /v1/tools/:toolId", ["tool.delete", "tool", ":toolId"]],
  ["POST /v1/tools/:toolId/run", ["tool.run", "tool", ":toolId"]],
  [
    "POST /v1/profiles/:profileId/tools",
    ["profile.tools.create", "tools", ":profileId"],
  ],
  [
    "DELETE /v1/profiles/:profileId/tools/:toolId",
    ["profile.tools.delete", "tools", ":toolId"],
  ],
  // Registered only when Composio and computer auth are configured.
  [
    "POST /v1/composio/toolkits/:toolkitSlug/enable",
    ["composio.enable", "integration", ":toolkitSlug"],
  ],
  [
    "POST /v1/composio/toolkits/:toolkitSlug/disable",
    ["composio.disable", "integration", ":toolkitSlug"],
  ],
  [
    "POST /v1/composio/toolkits/:toolkitSlug/connect",
    ["composio.connect", "integration", ":toolkitSlug"],
  ],
  [
    "POST /v1/composio/meet/:toolkitSlug/connect",
    ["composio.connect", "integration", ":toolkitSlug"],
  ],
  [
    "POST /v1/composio/toolkits/:toolkitSlug/disconnect",
    ["composio.disconnect", "integration", ":toolkitSlug"],
  ],
  [
    "POST /v1/composio/toolkits/:toolkitSlug/sync",
    ["composio.sync", "integration", ":toolkitSlug"],
  ],
  [
    "PUT /v1/profiles/:profileId/composio-toolkits",
    ["profile.composio_toolkit", "profile", ":profileId"],
  ],
  ["POST /v1/computers", ["computer.create", "computer"]],
  ["DELETE /v1/computers/:id", ["computer.delete", "computer", ":id"]],
  ["DELETE /v1/llm/computer", ["computer.delete", "computer"]],
  [
    "POST /v1/plugins/official/:pluginId/install",
    ["plugin.install", "plugin", ":pluginId"],
  ],
  [
    "POST /v1/plugins/official/:pluginId/reinstall",
    ["plugin.reinstall", "plugin", ":pluginId"],
  ],
  [
    "POST /v1/platform/plugins/install-local",
    ["plugin.install_local", "plugin"],
  ],
  ["POST /v1/platform/plugins/releases", ["plugin.release_install", "plugin"]],
  [
    "DELETE /v1/platform/plugins/releases/:pluginId/:version",
    ["plugin.release_delete", "plugin", ":pluginId@:version"],
  ],
  [
    "POST /v1/plugins/:pluginId/install",
    ["plugin.install", "plugin", ":pluginId"],
  ],
  [
    "POST /v1/plugins/:pluginId/enable",
    ["plugin.enable", "plugin", ":pluginId"],
  ],
  [
    "POST /v1/plugins/:pluginId/disable",
    ["plugin.disable", "plugin", ":pluginId"],
  ],
  [
    "POST /v1/plugins/:pluginId/update",
    ["plugin.update", "plugin", ":pluginId"],
  ],
  [
    "POST /v1/plugins/:pluginId/uninstall",
    ["plugin.uninstall", "plugin", ":pluginId"],
  ],
  [
    "POST /v1/plugins/:pluginId/retained-data/delete",
    ["plugin.retained_data_delete", "plugin", ":pluginId"],
  ],
  ["POST /v1/automations", ["automation.create", "automation"]],
  [
    "PUT /v1/automations/:automationId",
    ["automation.update", "automation", ":automationId"],
  ],
  [
    "DELETE /v1/automations/:automationId",
    ["automation.delete", "automation", ":automationId"],
  ],
  [
    "POST /v1/automations/:automationId/run",
    ["automation.run", "automation", ":automationId"],
  ],
  [
    "POST /v1/automations/:automationId/webhook-secret",
    ["automation.webhook_secret_rotate", "automation", ":automationId"],
  ],
  [
    "POST /v1/automations/:automationId/webhook",
    ["automation.trigger", "automation", ":automationId"],
  ],
  ["POST /v1/notification-destinations", ["destination.create", "destination"]],
  [
    "PUT /v1/notification-destinations/:destinationId",
    ["destination.update", "destination", ":destinationId"],
  ],
  [
    "POST /v1/notification-destinations/:destinationId/rotate-key",
    ["destination.rotate_key", "destination", ":destinationId"],
  ],
  [
    "DELETE /v1/notification-destinations/:destinationId",
    ["destination.delete", "destination", ":destinationId"],
  ],
];
