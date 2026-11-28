import type { AuditRule } from "./audit-log-routes";

/** Audit rules for organization, member, invite, and org-memory lifecycle. */
export const ORGS_AUDIT_ROUTES: ReadonlyArray<readonly [string, AuditRule]> = [
  [
    "POST /v1/internal/curator/orgs/:orgId/run",
    ["memory.curator_run", "memory", null, ":orgId"],
  ],
  ["POST /v1/auth/orgs", ["organization.create", "organization"]],
  [
    "POST /v1/orgs/:orgId/knowledge-base",
    ["org.knowledge_base_create", "knowledge_base", null, ":orgId"],
  ],
  [
    "DELETE /v1/orgs/:orgId/knowledge-base/:documentId",
    ["org.knowledge_base_delete", "knowledge_base", ":documentId", ":orgId"],
  ],
  ["POST /v1/platform/orgs", ["organization.create", "organization"]],
  [
    "PATCH /v1/platform/orgs/:orgId",
    ["organization.update", "organization", ":orgId", ":orgId"],
  ],
  [
    "DELETE /v1/platform/orgs/:orgId",
    ["organization.archive", "organization", ":orgId", ":orgId"],
  ],
  [
    "DELETE /v1/platform/orgs/:orgId/permanent",
    ["organization.delete", "organization", ":orgId", ":orgId"],
  ],
  [
    "POST /v1/platform/orgs/:orgId/invites",
    ["invite.create", "invite", null, ":orgId"],
  ],
  [
    "POST /v1/platform/orgs/:orgId/members/:userId/disable",
    ["member.disable", "user", ":userId", ":orgId"],
  ],
  [
    "POST /v1/platform/orgs/:orgId/members/:userId/enable",
    ["member.enable", "user", ":userId", ":orgId"],
  ],
  [
    "DELETE /v1/platform/users/:userId",
    ["user.erase", "user", ":userId", null],
  ],
  [
    "POST /v1/orgs/:orgId/shared-resources",
    ["share.create", "share", null, ":orgId"],
  ],
  [
    "DELETE /v1/orgs/:orgId/shared-resources/:publicationId",
    ["share.delete", "share", ":publicationId", ":orgId"],
  ],
  ["POST /v1/orgs/:orgId/teams", ["team.create", "team", null, ":orgId"]],
  ["POST /v1/orgs/:orgId/members", ["member.add", "user", null, ":orgId"]],
  ["POST /v1/orgs/:orgId/invites", ["invite.create", "invite", null, ":orgId"]],
  [
    "DELETE /v1/orgs/:orgId/invites/:inviteId",
    ["invite.revoke", "invite", ":inviteId", ":orgId"],
  ],
  [
    "POST /v1/orgs/:orgId/join-requests/:userId/approve",
    ["member.approve", "user", ":userId", ":orgId"],
  ],
  [
    "DELETE /v1/orgs/:orgId/join-requests/:userId",
    ["member.reject", "user", ":userId", ":orgId"],
  ],
  [
    "PATCH /v1/orgs/:orgId/members/:userId",
    ["member.role_update", "user", ":userId", ":orgId"],
  ],
  [
    "DELETE /v1/orgs/:orgId/members/:userId",
    ["member.remove", "user", ":userId", ":orgId"],
  ],
  [
    "PATCH /v1/orgs/:orgId",
    ["organization.update", "organization", ":orgId", ":orgId"],
  ],
  ["PUT /v1/orgs/:orgId/memory", ["memory.update", "memory", null, ":orgId"]],
  [
    "POST /v1/orgs/:orgId/memory/facts",
    ["memory.facts", "memory", null, ":orgId"],
  ],
  ["POST /v1/orgs/:orgId/memory/pin", ["memory.pin", "memory", null, ":orgId"]],
  [
    "POST /v1/orgs/:orgId/memory/unpin",
    ["memory.unpin", "memory", null, ":orgId"],
  ],
  [
    "POST /v1/orgs/:orgId/memory/archive",
    ["memory.archive", "memory", null, ":orgId"],
  ],
  [
    "POST /v1/orgs/:orgId/memory/history/undo",
    ["memory.undo", "memory", null, ":orgId"],
  ],
  [
    "POST /v1/orgs/:orgId/memory/history/:revisionId/restore",
    ["memory.restore", "memory", null, ":orgId"],
  ],
  [
    "POST /v1/orgs/:orgId/memory/proposals/:proposalId/approve",
    ["memory.proposal_approve", "memory", ":proposalId", ":orgId"],
  ],
  [
    "POST /v1/orgs/:orgId/memory/proposals/:proposalId/reject",
    ["memory.proposal_reject", "memory", ":proposalId", ":orgId"],
  ],
  [
    "POST /v1/orgs/:orgId/curator/run",
    ["memory.curator_run", "memory", null, ":orgId"],
  ],
  [
    "POST /v1/orgs/:orgId/skill-proposals/:proposalId/approve",
    ["skill.proposal_approve", "skill", ":proposalId", ":orgId"],
  ],
  [
    "POST /v1/orgs/:orgId/skill-proposals/:proposalId/reject",
    ["skill.proposal_reject", "skill", ":proposalId", ":orgId"],
  ],
  [
    "POST /v1/orgs/:orgId/skill-suggestions/:suggestionId/apply",
    ["skill.suggestion_apply", "skill", ":suggestionId", ":orgId"],
  ],
];
