import type { StoredAuditEvent } from "@nakama/db";

export type AuditDescriptor = Pick<
  StoredAuditEvent,
  "action" | "resourceId" | "resourceType"
> & { orgId?: string | null };

export function event(
  action: string,
  resourceType: string,
  resourceId?: string
): AuditDescriptor {
  return {
    action,
    resourceId: resourceId ? decodePathPart(resourceId) : null,
    resourceType,
  };
}

/** Like `event`, but pins the organization to the one in the request path. */
export function orgEvent(
  action: string,
  resourceType: string,
  orgId: string | undefined,
  resourceId?: string
): AuditDescriptor {
  return {
    ...event(action, resourceType, resourceId),
    orgId: decodePathPart(orgId),
  };
}

export function decodePathPart(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function describeResourceAuditEvent(
  method: string,
  pathname: string
): AuditDescriptor | null {
  // Skills management. install/sync are matched before the generic /:skillId
  // rule, or "install" would classify as a skill id.
  let match = pathname.match(/^\/v1\/skills\/(install|sync)$/);

  if (match && method === "POST") {
    return event(`skill.${match[1]}`, "skill");
  }

  match = pathname.match(
    /^\/v1\/skills\/([^/]+)\/(?:python-packages|versions\/[^/]+\/restore)$/
  );

  if (match && method === "POST") {
    return event(
      pathname.endsWith("/restore")
        ? "skill.version_restore"
        : "skill.python_packages",
      "skill",
      match[1]
    );
  }

  match = pathname.match(/^\/v1\/skills\/([^/]+)$/);

  if (match && (method === "PATCH" || method === "DELETE")) {
    return event(
      method === "PATCH" ? "skill.update" : "skill.delete",
      "skill",
      match[1]
    );
  }

  if (pathname === "/v1/skills" && method === "POST") {
    return event("skill.create", "skill");
  }

  // Tools management and the playground run, which executes a tool outside a
  // chat turn.
  if (pathname === "/v1/tools" && method === "POST") {
    return event("tool.create", "tool");
  }

  match = pathname.match(/^\/v1\/tools\/([^/]+)$/);

  if (match && method === "DELETE") {
    return event("tool.delete", "tool", match[1]);
  }

  match = pathname.match(/^\/v1\/tools\/([^/]+)\/credentials$/);

  if (match && method === "PUT") {
    return event("tool.credentials_update", "tool", match[1]);
  }

  match = pathname.match(/^\/v1\/tools\/([^/]+)\/run$/);

  if (match && method === "POST") {
    return event("tool.run", "tool", match[1]);
  }

  match = pathname.match(/^\/v1\/tool-setups\/([^/]+)$/);

  if (match && (method === "POST" || method === "DELETE")) {
    return event(
      method === "POST" ? "tool_setup.update" : "tool_setup.delete",
      "tool_setup",
      match[1]
    );
  }

  match = pathname.match(/^\/v1\/automations\/([^/]+)\/(run|webhook)$/);

  if (match && method === "POST") {
    return event(
      match[2] === "run" ? "automation.run" : "automation.trigger",
      "automation",
      match[1]
    );
  }

  match = pathname.match(/^\/v1\/internal\/automations\/([^/]+)\/run$/);

  if (match && method === "POST") {
    return event("automation.run", "automation", match[1]);
  }

  match = pathname.match(/^\/v1\/internal\/curator\/orgs\/([^/]+)\/run$/);

  if (match && method === "POST") {
    return orgEvent("memory.curator_run", "memory", match[1]);
  }

  match = pathname.match(/^\/v1\/automations\/([^/]+)$/);

  if (match && (method === "PUT" || method === "DELETE")) {
    return event(
      method === "PUT" ? "automation.update" : "automation.delete",
      "automation",
      match[1]
    );
  }

  if (pathname === "/v1/automations" && method === "POST") {
    return event("automation.create", "automation");
  }

  match = pathname.match(/^\/v1\/mcp\/servers\/([^/]+)\/(connect|sync)$/);

  if (match && method === "POST") {
    return event(`mcp_server.${match[2]}`, "mcp_server", match[1]);
  }

  match = pathname.match(/^\/v1\/mcp\/servers\/([^/]+)$/);

  if (match && (method === "PATCH" || method === "DELETE")) {
    return event(
      method === "PATCH" ? "mcp_server.update" : "mcp_server.delete",
      "mcp_server",
      match[1]
    );
  }

  if (pathname === "/v1/mcp/servers" && method === "POST") {
    return event("mcp_server.create", "mcp_server");
  }

  match = pathname.match(
    /^\/v1\/plugins\/official\/([^/]+)\/(install|reinstall)$/
  );

  if (match && method === "POST") {
    return event(
      match[2] === "install" ? "plugin.install" : "plugin.reinstall",
      "plugin",
      match[1]
    );
  }

  match = pathname.match(
    /^\/v1\/plugins\/([^/]+)\/(install|uninstall|enable|disable|update)$/
  );

  if (match && method === "POST") {
    return event(`plugin.${match[2]}`, "plugin", match[1]);
  }

  match = pathname.match(/^\/v1\/plugins\/([^/]+)\/retained-data\/delete$/);

  if (match && method === "POST") {
    return event("plugin.retained_data_delete", "plugin", match[1]);
  }

  match = pathname.match(/^\/v1\/platform\/plugins\/install-local$/);

  if (match && method === "POST") {
    return event("plugin.install_local", "plugin");
  }

  match = pathname.match(
    /^\/v1\/platform\/plugins\/releases\/([^/]+)\/([^/]+)$/
  );

  if (match && method === "DELETE") {
    return event("plugin.release_delete", "plugin", `${match[1]}@${match[2]}`);
  }

  match = pathname.match(
    /^\/v1\/notification-destinations\/([^/]+)\/rotate-key$/
  );

  if (match && method === "POST") {
    return event("destination.rotate_key", "destination", match[1]);
  }

  match = pathname.match(/^\/v1\/notification-destinations(?:\/([^/]+))?$/);

  if (match && ["POST", "PUT", "DELETE"].includes(method)) {
    return event(
      method === "POST"
        ? "destination.create"
        : method === "PUT"
          ? "destination.update"
          : "destination.delete",
      "destination",
      match[1]
    );
  }

  match = pathname.match(/^\/v1\/providers\/([^/]+)\/(default|secret)$/);

  if (match && (method === "POST" || method === "PUT")) {
    return event("provider.update", "provider", match[1]);
  }

  match = pathname.match(/^\/v1\/([a-z]+)-oauth\/device\/complete$/);

  if (match && method === "POST") {
    return event("provider.oauth_complete", "provider", match[1]);
  }

  // Channel pairing changes who can reach this installation through a
  // messaging platform, so every pairing step is a security event.
  match = pathname.match(
    /^\/v1\/settings\/([^/]+)\/(handshake|pairing-code|reconnect|claim)$/
  );

  if (match && method === "POST") {
    return event("channel.pairing", "channel", match[1]);
  }

  match = pathname.match(
    /^\/v1\/settings\/telegram\/pairing(?:\/[^/]+(?:\/(apply|cancel))?)?$/
  );

  if (match && method === "POST") {
    return event("channel.pairing", "channel", "telegram");
  }

  match = pathname.match(
    /^\/v1\/settings\/telegram\/requests\/([^/]+)\/(approve|deny)$/
  );

  if (match && method === "POST") {
    return event("channel.pairing", "channel", match[1]);
  }

  match = pathname.match(/^\/v1\/settings\/agent-browser\/install$/);

  if (match && method === "POST") {
    return event("settings.agent_browser_install", "setting", "agent-browser");
  }

  match = pathname.match(/^\/v1\/settings\/([^/]+)\/secret$/);

  if (match && (method === "PUT" || method === "POST")) {
    return event("settings.update", "setting", match[1]);
  }

  match = pathname.match(/^\/v1\/settings\/([^/]+)$/);

  if (match && (method === "PUT" || method === "POST")) {
    return event("settings.update", "setting", match[1]);
  }

  match = pathname.match(/^\/v1\/orgs\/([^/]+)\/teams$/);

  if (match && method === "POST") {
    return orgEvent("team.create", "team", match[1]);
  }

  match = pathname.match(/^\/v1\/orgs\/([^/]+)\/knowledge-base(?:\/([^/]+))?$/);

  if (match && (method === "POST" || method === "DELETE")) {
    return orgEvent(
      method === "POST"
        ? "org.knowledge_base_create"
        : "org.knowledge_base_delete",
      "knowledge_base",
      match[1],
      match[2]
    );
  }

  match = pathname.match(
    /^\/v1\/orgs\/([^/]+)\/memory(?:\/(facts|archive|pin|unpin))?$/
  );

  if (match && (method === "POST" || method === "PUT")) {
    return orgEvent(
      match[2] ? `memory.${match[2]}` : "memory.update",
      "memory",
      match[1]
    );
  }

  match = pathname.match(
    /^\/v1\/orgs\/([^/]+)\/memory\/history\/(?:undo|([^/]+)\/restore)$/
  );

  if (match && method === "POST") {
    return orgEvent(
      pathname.endsWith("/undo") ? "memory.undo" : "memory.restore",
      "memory",
      match[1]
    );
  }

  match = pathname.match(
    /^\/v1\/orgs\/([^/]+)\/memory\/proposals\/([^/]+)\/(approve|reject)$/
  );

  if (match && method === "POST") {
    return orgEvent(
      `memory.proposal_${match[3]}`,
      "memory",
      match[1],
      match[2]
    );
  }

  match = pathname.match(/^\/v1\/orgs\/([^/]+)\/curator\/run$/);

  if (match && method === "POST") {
    return orgEvent("memory.curator_run", "memory", match[1]);
  }

  match = pathname.match(
    /^\/v1\/(?:platform\/)?orgs\/([^/]+)\/shared-resources(?:\/([^/]+))?$/
  );

  if (match && (method === "POST" || method === "DELETE")) {
    return orgEvent(
      method === "POST" ? "share.create" : "share.delete",
      "share",
      match[1],
      match[2]
    );
  }

  match = pathname.match(
    /^\/v1\/orgs\/([^/]+)\/skill-proposals\/([^/]+)\/(approve|reject)$/
  );

  if (match && method === "POST") {
    return orgEvent(`skill.proposal_${match[3]}`, "skill", match[1], match[2]);
  }

  match = pathname.match(
    /^\/v1\/orgs\/([^/]+)\/skill-suggestions\/([^/]+)\/apply$/
  );

  if (match && method === "POST") {
    return orgEvent("skill.suggestion_apply", "skill", match[1], match[2]);
  }

  match = pathname.match(/^\/v1\/profiles\/([^/]+)\/(?:avatar|soul\/init)$/);

  if (match && (method === "PUT" || method === "POST")) {
    return event(
      pathname.endsWith("/soul/init") ? "profile.soul_init" : "profile.avatar",
      "profile",
      match[1]
    );
  }

  match = pathname.match(
    /^\/v1\/profiles\/([^/]+)\/knowledge-base(?:\/(import-zip))?$/
  );

  if (match && method === "POST") {
    return event(
      match[2]
        ? "profile.knowledge_base_import"
        : "profile.knowledge_base_create",
      "knowledge_base",
      match[1]
    );
  }

  match = pathname.match(/^\/v1\/profiles\/([^/]+)\/knowledge-base\/([^/]+)$/);

  if (match && method === "DELETE") {
    return event("profile.knowledge_base_delete", "knowledge_base", match[2]);
  }

  match = pathname.match(/^\/v1\/profiles\/([^/]+)\/artifacts(?:\/content)?$/);

  if (match && (method === "POST" || method === "PUT")) {
    return event("artifact.create", "artifact", match[1]);
  }

  match = pathname.match(/^\/v1\/profiles\/([^/]+)\/artifacts$/);

  if (match && method === "DELETE") {
    return event("artifact.delete", "artifact", match[1]);
  }

  match = pathname.match(
    /^\/v1\/profiles\/([^/]+)\/artifacts\/shares(?:\/([^/]+))?$/
  );

  if (match && (method === "POST" || method === "DELETE")) {
    return event(
      method === "POST" ? "share.create" : "share.delete",
      "share",
      match[2] ?? match[1]
    );
  }

  match = pathname.match(
    /^\/v1\/composio\/(?:meet\/)?toolkits\/([^/]+)\/(connect|disconnect|enable|disable|sync)$/
  );

  if (match && method === "POST") {
    return event(`composio.${match[2]}`, "integration", match[1]);
  }

  match = pathname.match(/^\/v1\/profiles\/([^/]+)\/composio-toolkits$/);

  if (match && method === "PUT") {
    return event("profile.composio_toolkit", "profile", match[1]);
  }

  match = pathname.match(/^\/v1\/profiles\/([^/]+)\/regression-cases$/);

  if (match && method === "POST") {
    return event("regression.create", "regression_case", match[1]);
  }

  match = pathname.match(/^\/v1\/profiles\/([^/]+)\/acp-settings\/([^/]+)$/);

  if (match && method === "PUT") {
    return event("profile.acp_settings", "profile", match[1]);
  }

  match = pathname.match(/^\/v1\/sessions\/([^/]+)\/acp-settings\/([^/]+)$/);

  if (match && method === "PUT") {
    return event("profile.acp_settings", "profile", match[2]);
  }

  match = pathname.match(/^\/v1\/sessions\/([^/]+)\/(branch|compact|stop)$/);

  if (match && method === "POST") {
    return event(`session.${match[2]}`, "session", match[1]);
  }

  match = pathname.match(/^\/v1\/sessions\/([^/]+)\/browser$/);

  if (match && method === "DELETE") {
    return event("session.browser_disconnect", "session", match[1]);
  }

  match = pathname.match(/^\/v1\/sessions$/);

  if (match && method === "POST") {
    return event("session.create", "session");
  }

  match = pathname.match(/^\/v1\/sessions\/([^/]+)$/);

  if (match && method === "PATCH") {
    return event("session.update", "session", match[1]);
  }

  match = pathname.match(/^\/v1\/computers(?:\/([^/]+))?$/);

  if (match && (method === "POST" || method === "DELETE")) {
    return event(
      method === "POST" ? "computer.create" : "computer.delete",
      "computer",
      match[1]
    );
  }

  match = pathname.match(/^\/v1\/llm\/computer$/);

  if (match && method === "DELETE") {
    return event("computer.delete", "computer");
  }

  match = pathname.match(/^\/v1\/system\/upgrade$/);

  if (match && method === "POST") {
    return event("system.upgrade", "installation");
  }

  match = pathname.match(/^\/v1\/system\/web-public-url$/);

  if (match && method === "PUT") {
    return event("system.update", "installation");
  }

  match = pathname.match(/^\/v1\/workers\/([^/]+)\/clear-logs$/);

  if (match && method === "POST") {
    return event("worker.clear_logs", "worker", match[1]);
  }

  return null;
}
