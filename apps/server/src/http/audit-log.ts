import { log } from "@nakama/core";
import type { DatabaseAdapter, StoredAuditEvent } from "@nakama/db";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./types";

type AuditDescriptor = Pick<
  StoredAuditEvent,
  "action" | "resourceId" | "resourceType"
> & { orgId?: string | null };

const FIXED_EVENTS = new Map<string, AuditDescriptor>([
  ["PATCH /v1/auth/me", event("account.update", "user")],
  ["POST /v1/auth/accept-invite", event("invite.accept", "invite")],
  ["POST /v1/auth/change-password", event("auth.password_change", "user")],
  ["POST /v1/auth/local-token/rotate", event("auth.token_rotate", "token")],
  ["POST /v1/auth/login", event("auth.login", "user")],
  ["POST /v1/auth/logout", event("auth.logout", "session")],
  ["POST /v1/auth/orgs", event("organization.create", "organization")],
  ["POST /v1/auth/setup", event("auth.setup", "user")],
  ["GET /v1/platform/data/export", event("data.export", "installation")],
  [
    "POST /v1/platform/data/import/restore",
    event("data.import", "installation"),
  ],
  ["POST /v1/profiles/pack/import", event("profile.import", "profile")],
]);

/**
 * Security-event coverage checklist:
 * - authentication: setup, login success/failure, logout, password change, token rotation
 * - authorization: organization/member/invite lifecycle and role changes
 * - configuration: providers and installation settings
 * - sensitive resources: profile/org CRUD, export/import, session revocation
 *
 * Add a rule here whenever a new route joins one of those classes. Request
 * bodies are intentionally never recorded, so credentials cannot enter metadata.
 */
export function describeAuditEvent(
  method: string,
  pathname: string
): AuditDescriptor | null {
  const fixed = FIXED_EVENTS.get(`${method} ${pathname}`);
  if (fixed) {
    return fixed;
  }

  let match = pathname.match(/^\/v1\/providers\/([^/]+)$/);
  if (match && (method === "PATCH" || method === "DELETE")) {
    return event(
      method === "PATCH" ? "provider.update" : "provider.delete",
      "provider",
      match[1]
    );
  }
  if (pathname === "/v1/providers" && method === "POST") {
    return event("provider.create", "provider");
  }

  match = pathname.match(/^\/v1\/settings\/([^/]+)$/);
  if (match && method === "PUT") {
    return event("settings.update", "setting", match[1]);
  }

  match = pathname.match(/^\/v1\/platform\/orgs\/([^/]+)$/);
  if (match && (method === "PATCH" || method === "DELETE")) {
    return {
      ...event(
        method === "PATCH" ? "organization.update" : "organization.archive",
        "organization",
        match[1]
      ),
      orgId: decodePathPart(match[1]),
    };
  }
  if (pathname === "/v1/platform/orgs" && method === "POST") {
    return event("organization.create", "organization");
  }

  match = pathname.match(
    /^\/v1\/(?:platform\/)?orgs\/([^/]+)\/invites(?:\/([^/]+))?$/
  );
  if (match && (method === "POST" || method === "DELETE")) {
    return {
      ...event(
        method === "POST" ? "invite.create" : "invite.revoke",
        "invite",
        match[2]
      ),
      orgId: decodePathPart(match[1]),
    };
  }

  match = pathname.match(
    /^\/v1\/(?:platform\/)?orgs\/([^/]+)\/members\/([^/]+)(?:\/(disable|enable))?$/
  );
  if (match && ["DELETE", "PATCH", "POST"].includes(method)) {
    const operation = match[3];
    const action =
      operation === "disable"
        ? "member.disable"
        : operation === "enable"
          ? "member.enable"
          : method === "DELETE"
            ? "member.remove"
            : "member.role_update";
    return {
      ...event(action, "user", match[2]),
      orgId: decodePathPart(match[1]),
    };
  }

  match = pathname.match(/^\/v1\/orgs\/([^/]+)\/members$/);
  if (match && method === "POST") {
    return {
      ...event("member.add", "user"),
      orgId: decodePathPart(match[1]),
    };
  }

  match = pathname.match(/^\/v1\/orgs\/([^/]+)$/);
  if (match && method === "PATCH") {
    return {
      ...event("organization.update", "organization", match[1]),
      orgId: decodePathPart(match[1]),
    };
  }

  match = pathname.match(/^\/v1\/profiles\/([^/]+)(?:\/(clone|move))?$/);
  if (match && ["DELETE", "POST", "PUT"].includes(method)) {
    const operation = match[2];
    const action = operation
      ? `profile.${operation}`
      : method === "DELETE"
        ? "profile.delete"
        : "profile.update";
    return event(action, "profile", match[1]);
  }
  if (pathname === "/v1/profiles" && method === "POST") {
    return event("profile.create", "profile");
  }

  match = pathname.match(/^\/v1\/profiles\/([^/]+)\/pack\/export$/);
  if (match && method === "GET") {
    return event("profile.export", "profile", match[1]);
  }

  match = pathname.match(/^\/v1\/sessions\/([^/]+)$/);
  if (match && method === "DELETE") {
    return event("session.revoke", "session", match[1]);
  }

  return null;
}

export function createAuditLogMiddleware(
  databaseAdapter: DatabaseAdapter
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const descriptor = describeAuditEvent(c.req.method, c.req.path);
    if (!descriptor) {
      await next();
      return;
    }

    let attemptedUserId: string | null = null;
    if (descriptor.action === "auth.login") {
      attemptedUserId = await resolveLoginUserId(c.req.raw, databaseAdapter);
    }

    await next();

    const status = c.res.status;
    if (status >= 400 && descriptor.action !== "auth.login") {
      return;
    }

    const auth = c.get("auth");
    const responseIdentity = await resolveResponseIdentity(c.res);
    const responseUserId = responseIdentity.email
      ? ((await databaseAdapter.getUserByEmail(responseIdentity.email))?.id ??
        null)
      : null;
    const actorUserId =
      auth?.user.id ??
      responseIdentity.userId ??
      responseUserId ??
      attemptedUserId;
    const orgId =
      descriptor.orgId ?? auth?.activeOrgId ?? responseIdentity.orgId ?? null;

    try {
      await databaseAdapter.createAuditEvent({
        action: descriptor.action,
        actorUserId,
        createdAt: new Date().toISOString(),
        id: `audit_${crypto.randomUUID()}`,
        metadata: {
          outcome: status < 400 ? "success" : "failure",
          status,
        },
        orgId,
        requestId: c.get("requestId") ?? null,
        resourceId:
          descriptor.resourceId ??
          responseIdentity.resourceId ??
          (descriptor.resourceType === "user" ? actorUserId : null),
        resourceType: descriptor.resourceType,
      });
    } catch (error) {
      log("error", "audit.write_failed", {
        action: descriptor.action,
        error: error instanceof Error ? error.message : String(error),
        requestId: c.get("requestId"),
      });
    }
  };
}

function event(
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

function decodePathPart(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function resolveLoginUserId(
  request: Request,
  databaseAdapter: DatabaseAdapter
): Promise<string | null> {
  try {
    const body = (await request.clone().json()) as { email?: unknown };
    if (typeof body.email !== "string") {
      return null;
    }
    return (await databaseAdapter.getUserByEmail(body.email))?.id ?? null;
  } catch {
    return null;
  }
}

async function resolveResponseIdentity(response: Response): Promise<{
  email: string | null;
  orgId: string | null;
  resourceId: string | null;
  userId: string | null;
}> {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return { email: null, orgId: null, resourceId: null, userId: null };
  }

  try {
    const body = (await response.clone().json()) as Record<string, unknown>;
    const organization = body.organization as
      | Record<string, unknown>
      | undefined;
    const profile = body.profile as Record<string, unknown> | undefined;
    const invite = body.invite as Record<string, unknown> | undefined;
    const member = body.member as Record<string, unknown> | undefined;
    return {
      email: stringValue(body.email),
      orgId:
        stringValue(body.activeOrgId) ??
        stringValue(body.orgId) ??
        stringValue(organization?.id),
      resourceId:
        stringValue(body.profileId) ??
        stringValue(profile?.id) ??
        stringValue(invite?.id) ??
        stringValue(member?.userId) ??
        stringValue(organization?.id) ??
        stringValue(body.id),
      userId: stringValue(body.id),
    };
  } catch {
    return { email: null, orgId: null, resourceId: null, userId: null };
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
