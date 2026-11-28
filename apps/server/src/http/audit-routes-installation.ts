import type { AuditRule } from "./audit-log-routes";

/** Audit rules for sign-in, account, installation settings, providers, and platform data. */
export const INSTALLATION_AUDIT_ROUTES: ReadonlyArray<
  readonly [string, AuditRule]
> = [
  [
    "POST /v1/internal/automations/:automationId/run",
    ["automation.run", "automation", ":automationId"],
  ],
  // This server's own Nakama Cloud sign-in: it changes the default provider.
  [
    "POST /v1/nakama-cloud/sign-in",
    ["provider.nakama_cloud_sign_in", "provider", "nakama-cloud", null],
  ],
  [
    "DELETE /v1/nakama-cloud",
    ["provider.nakama_cloud_sign_out", "provider", "nakama-cloud", null],
  ],
  ["POST /v1/system/upgrade", ["system.upgrade", "installation", null, null]],
  [
    "PUT /v1/system/web-public-url",
    ["system.update", "installation", null, null],
  ],
  // Reading the whole audit trail is itself a sensitive read, so the export
  // lands in the same ledger, like tera-router's export that audits itself.
  [
    "GET /v1/platform/audit-events/export",
    ["audit.export", "audit", null, null],
  ],
  [
    "PUT /v1/platform/audit-events/retention",
    ["settings.update", "setting", "audit-retention", null],
  ],
  ["POST /v1/auth/setup", ["auth.setup", "user"]],
  ["POST /v1/auth/login", ["auth.login", "user"]],
  ["POST /v1/auth/mfa/backup-codes", ["auth.backup_codes_regenerate", "user"]],
  ["POST /v1/auth/mfa/passkey/verify", ["auth.passkey_register", "user"]],
  ["POST /v1/auth/mfa/passkey/disable", ["auth.passkey_disable", "user"]],
  ["PUT /v1/settings/mfa", ["settings.update", "setting", "mfa", null]],
  ["POST /v1/auth/mfa/totp/verify", ["auth.mfa_totp_enable", "user"]],
  ["POST /v1/auth/mfa/disable", ["auth.mfa_disable", "user"]],
  ["PATCH /v1/auth/me", ["account.update", "user"]],
  ["POST /v1/auth/logout", ["auth.logout", "session"]],
  ["POST /v1/auth/change-password", ["auth.password_change", "user"]],
  [
    "POST /v1/auth/password-reset/request",
    ["auth.password_reset_request", "user"],
  ],
  [
    "POST /v1/auth/password-reset/complete",
    ["auth.password_reset_complete", "user"],
  ],
  ["POST /v1/auth/accept-invite", ["invite.accept", "invite"]],
  ["POST /v1/auth/local-token/rotate", ["auth.token_rotate", "token"]],
  ["POST /v1/auth/active-org", ["auth.active_org", "organization"]],
  [
    "DELETE /v1/auth/sessions/:sessionId",
    ["session.revoke", "session", ":sessionId"],
  ],
  [
    "DELETE /v1/auth/users/:userId/sessions",
    ["session.revoke_all", "user", ":userId", null],
  ],
  [
    "POST /v1/auth/setup/import/restore",
    ["data.import", "installation", null, null],
  ],
  [
    "POST /v1/workers/:name/clear-logs",
    ["worker.clear_logs", "worker", ":name", null],
  ],
  ["POST /v1/providers", ["provider.create", "provider", null, null]],
  [
    "PATCH /v1/providers/:providerId",
    ["provider.update", "provider", ":providerId", null],
  ],
  [
    "POST /v1/providers/:providerId/default",
    ["provider.update", "provider", ":providerId", null],
  ],
  [
    "DELETE /v1/providers/:providerId",
    ["provider.delete", "provider", ":providerId", null],
  ],
  [
    "PUT /v1/providers/:providerId/secret",
    ["provider.update", "provider", ":providerId", null],
  ],
  [
    "DELETE /v1/providers/:providerId/secret",
    ["provider.update", "provider", ":providerId", null],
  ],
  [
    "POST /v1/providers/:providerId/secret/use-stored",
    ["provider.update", "provider", ":providerId", null],
  ],
  [
    "POST /v1/xai-oauth/device/complete",
    ["provider.oauth_complete", "provider", "xai", null],
  ],
  [
    "POST /v1/chatgpt-oauth/device/complete",
    ["provider.oauth_complete", "provider", "chatgpt", null],
  ],
  [
    "PUT /v1/settings/provider",
    ["settings.update", "setting", "provider", null],
  ],
  [
    "PUT /v1/settings/timezone",
    ["settings.update", "setting", "timezone", null],
  ],
  [
    "PUT /v1/settings/thinking",
    ["settings.update", "setting", "thinking", null],
  ],
  ["PUT /v1/settings/vision", ["settings.update", "setting", "vision", null]],
  [
    "PUT /v1/settings/video-generation",
    ["settings.update", "setting", "video-generation", null],
  ],
  [
    "PUT /v1/settings/transcription",
    ["settings.update", "setting", "transcription", null],
  ],
  [
    "PUT /v1/settings/image-generation",
    ["settings.update", "setting", "image-generation", null],
  ],
  ["PUT /v1/settings/email", ["settings.update", "setting", "email", null]],
  [
    "PUT /v1/settings/email/secret",
    ["settings.update", "setting", "email", null],
  ],
  [
    "DELETE /v1/settings/email/secret",
    ["settings.update", "setting", "email", null],
  ],
  [
    "POST /v1/settings/email/secret/use-stored",
    ["settings.update", "setting", "email", null],
  ],
  [
    "PUT /v1/settings/web-search",
    ["settings.update", "setting", "web-search", null],
  ],
  [
    "PUT /v1/settings/web-search/secret",
    ["settings.update", "setting", "web-search", null],
  ],
  [
    "DELETE /v1/settings/web-search/secret",
    ["settings.update", "setting", "web-search", null],
  ],
  [
    "POST /v1/settings/web-search/secret/use-stored",
    ["settings.update", "setting", "web-search", null],
  ],
  [
    "PUT /v1/settings/agent-browser",
    ["settings.update", "setting", "agent-browser", null],
  ],
  [
    "POST /v1/settings/agent-browser/install",
    ["settings.agent_browser_install", "setting", "agent-browser", null],
  ],
  [
    "POST /v1/settings/channel-legacy/claim",
    ["channel.pairing", "channel", "channel-legacy"],
  ],
  ["PUT /v1/settings/telegram", ["settings.update", "setting", "telegram"]],
  [
    "PUT /v1/settings/telegram/agent-group",
    ["settings.update", "setting", "telegram"],
  ],
  [
    "POST /v1/settings/telegram/handshake",
    ["channel.pairing", "channel", "telegram"],
  ],
  [
    "POST /v1/settings/telegram/requests/:userId/approve",
    ["channel.pairing", "channel", ":userId"],
  ],
  [
    "POST /v1/settings/telegram/requests/:userId/deny",
    ["channel.pairing", "channel", ":userId"],
  ],
  [
    "POST /v1/settings/telegram/pairing",
    ["channel.pairing", "channel", "telegram"],
  ],
  [
    "POST /v1/settings/telegram/pairing/:pairingId/cancel",
    ["channel.pairing", "channel", "telegram"],
  ],
  [
    "POST /v1/settings/telegram/pairing/:pairingId/apply",
    ["channel.pairing", "channel", "telegram"],
  ],
  ["PUT /v1/settings/discord", ["settings.update", "setting", "discord"]],
  [
    "POST /v1/settings/discord/handshake",
    ["channel.pairing", "channel", "discord"],
  ],
  ["PUT /v1/settings/slack", ["settings.update", "setting", "slack"]],
  [
    "POST /v1/settings/slack/handshake",
    ["channel.pairing", "channel", "slack"],
  ],
  [
    "PUT /v1/settings/composio",
    ["settings.update", "setting", "composio", null],
  ],
  [
    "PUT /v1/settings/composio/secret",
    ["settings.update", "setting", "composio", null],
  ],
  [
    "DELETE /v1/settings/composio/secret",
    ["settings.update", "setting", "composio", null],
  ],
  [
    "POST /v1/settings/composio/secret/use-stored",
    ["settings.update", "setting", "composio", null],
  ],
  [
    "PUT /v1/settings/error-tracking",
    ["settings.update", "setting", "error-tracking", null],
  ],
  ["PUT /v1/settings/whatsapp", ["settings.update", "setting", "whatsapp"]],
  [
    "POST /v1/settings/whatsapp/pairing-code",
    ["channel.pairing", "channel", "whatsapp"],
  ],
  [
    "POST /v1/settings/whatsapp/reconnect",
    ["channel.pairing", "channel", "whatsapp"],
  ],
  [
    "POST /v1/settings/teams/handshake",
    ["channel.pairing", "channel", "teams"],
  ],
  ["PUT /v1/settings/teams", ["settings.update", "setting", "teams"]],
  [
    "PUT /v1/settings/automation-worker",
    ["settings.update", "setting", "automation-worker", null],
  ],
  [
    "PUT /v1/settings/coding-harnesses",
    ["settings.update", "setting", "coding-harnesses", null],
  ],
  ["GET /v1/platform/data/export", ["data.export", "installation", null, null]],
  [
    "POST /v1/platform/data/import/restore",
    ["data.import", "installation", null, null],
  ],
];
