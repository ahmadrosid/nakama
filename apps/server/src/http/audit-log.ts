import { log } from "@nakama/core";
import type { CreateAuditEventInput, DatabaseAdapter } from "@nakama/db";
import type { MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import { z } from "zod";
import { describeAuditEvent } from "./audit-log-routes";
import { clientAddress } from "./rate-limit-middleware";
import type { AppEnv } from "./types";

export function createAuditLogMiddleware(
  databaseAdapter: DatabaseAdapter
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    // The last non-middleware match is the handler's pattern, known before it
    // runs, so requests that auth middleware rejects are still classified.
    const handler = matchedRoutes(c).findLast(
      (route) => route.method !== "ALL"
    );

    const descriptor = handler
      ? describeAuditEvent(
          c.req.method,
          handler.path,
          new URL(c.req.url).pathname
        )
      : null;

    if (!descriptor) {
      await next();

      return;
    }

    // Capture the request context before the route runs: the client address,
    // forwarded chain, and user agent do not change during a request.
    const clientIp = clientAddress(
      c,
      process.env.NAKAMA_TRUST_PROXY === "true"
    );

    const forwardedFor = c.req.header("x-forwarded-for") ?? null;
    const userAgent = c.req.header("user-agent")?.slice(0, 512) ?? null;
    const method = c.req.method;
    const route = c.req.path;

    // Login names its actor by email. A reset request names its target by
    // email, and the caller is often anonymous, so that user is the resource.
    let attemptedUserId: string | null = null;
    let targetUserId: string | null = null;

    if (descriptor.action === "auth.login") {
      attemptedUserId = await resolveBodyEmailUserId(
        c.req.raw,
        databaseAdapter
      );
    } else if (descriptor.action === "auth.password_reset_request") {
      targetUserId = await resolveBodyEmailUserId(c.req.raw, databaseAdapter);
    }

    await next();

    const status = c.res.status;
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

    const orgId = Object.hasOwn(descriptor, "orgId")
      ? (descriptor.orgId ?? null)
      : (auth?.activeOrgId ?? responseIdentity.orgId ?? null);

    try {
      const record: CreateAuditEventInput = {
        action: descriptor.action,
        actorMode: auth
          ? auth.mode === "browser-session"
            ? "session"
            : "token"
          : "anonymous",
        actorUserId,
        clientIp,
        createdAt: new Date().toISOString(),
        forwardedFor,
        id: `audit_${crypto.randomUUID()}`,
        metadata: {},
        method,
        orgId,
        outcome: status < 400 ? "success" : "failure",
        requestId: c.get("requestId") ?? null,
        resourceId:
          descriptor.resourceId ??
          c.get("auditResourceId") ??
          targetUserId ??
          responseIdentity.resourceId ??
          (descriptor.resourceType === "user" ? actorUserId : null),
        resourceType: descriptor.resourceType,
        route,
        sessionId: auth?.session?.id ?? null,
        status,
        userAgent,
      };

      await databaseAdapter.createAuditEvent(record);
    } catch (error) {
      log("error", "audit.write_failed", {
        action: descriptor.action,
        error: error instanceof Error ? error.message : String(error),
        requestId: c.get("requestId"),
      });
    }
  };
}

async function resolveBodyEmailUserId(
  request: Request,
  databaseAdapter: DatabaseAdapter
): Promise<string | null> {
  try {
    const parsed = bodyEmailSchema.safeParse(await request.clone().json());

    const email = parsed.success
      ? parsed.data.email?.trim().toLowerCase()
      : undefined;

    if (!email) {
      return null;
    }

    return (await databaseAdapter.getUserByEmail(email))?.id ?? null;
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
    const parsed = responseIdentitySchema.safeParse(
      await response.clone().json()
    );

    if (!parsed.success) {
      return { email: null, orgId: null, resourceId: null, userId: null };
    }

    const body = parsed.data;
    const organization = body.organization;
    const profile = body.profile;
    const invite = body.invite;
    const member = body.member;

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

const optionalIdentityString = z.string().optional().catch(undefined);

const bodyEmailSchema = z.object({
  email: optionalIdentityString,
});

const responseIdentitySchema = z
  .object({
    activeOrgId: optionalIdentityString,
    email: optionalIdentityString,
    id: optionalIdentityString,
    invite: z
      .object({ id: optionalIdentityString })
      .optional()
      .catch(undefined),
    member: z
      .object({ userId: optionalIdentityString })
      .optional()
      .catch(undefined),
    organization: z
      .object({ id: optionalIdentityString })
      .optional()
      .catch(undefined),
    orgId: optionalIdentityString,
    profile: z
      .object({ id: optionalIdentityString })
      .optional()
      .catch(undefined),
    profileId: optionalIdentityString,
  })
  .passthrough();

function stringValue(value: string | undefined): string | null {
  return value || null;
}
