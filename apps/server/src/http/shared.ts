import type { OrgRole } from "@nakama/core";
import {
  AGENT_CHANNELS,
  type AgentChannel,
  type ApiErrorResponse,
  HOST_BOUND_BROWSER_SESSION_COOKIE_NAMES,
  LOCAL_CLIENT_EMAIL,
  NakamaApiError,
  PLAIN_BROWSER_SESSION_COOKIE_NAMES,
  browserSessionCookieNames as resolveBrowserSessionCookieNames,
  type StreamEvent,
  verifyLocalAuthToken,
} from "@nakama/core";
import type {
  DatabaseAdapter,
  StoredBrowserSessionRecord,
  StoredUserRecord,
} from "@nakama/db";
import { ensureLocalClientAccess } from "@nakama/db";
import type { Context } from "hono";
import type { ZodType } from "zod";
import type { AuthService } from "../services/auth-service";
import { loadMfaPolicy } from "../services/mfa-config";
import { sessionTurnRegistry } from "../services/session-turn-registry";
import type { AppEnv } from "./types";

const LEGACY_COOKIE_NAMES = PLAIN_BROWSER_SESSION_COOKIE_NAMES;

const HOST_BOUND_COOKIE_NAMES = HOST_BOUND_BROWSER_SESSION_COOKIE_NAMES;

const CSRF_HEADER_NAME = "x-csrf-token";

const SESSION_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function parseCookies(header: string | null) {
  const cookies = new Map<string, string>();

  for (const part of header?.split(";") ?? []) {
    const [name, ...rest] = part.trim().split("=");

    if (!name || rest.length === 0) {
      continue;
    }

    cookies.set(name, rest.join("="));
  }

  return Object.fromEntries(cookies);
}

function buildCookie(
  name: string,
  value: string,
  options: {
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    sameSite?: "Lax" | "Strict" | "None";
    secure?: boolean;
  } = {}
): string {
  const parts = [`${name}=${value}`];

  parts.push(`Path=${options.path ?? "/"}`);

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  }

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function appendSetCookie(headers: Headers, cookie: string): void {
  headers.append("Set-Cookie", cookie);
}

function getRequestTokenFromCookies(
  request: Request,
  name: string
): string | null {
  const cookies = parseCookies(request.headers.get("Cookie"));

  return cookies[name]?.trim() || null;
}

function isMutatingMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

/**
 * Cookies must only carry the Secure flag when the browser is on HTTPS.
 * NODE_ENV=production alone is not enough — Docker serves HTTP by default and
 * browsers drop Secure cookies on http:// hosts (#112).
 *
 * X-Forwarded-Proto can upgrade http backends behind TLS terminators, but must
 * never downgrade an https request URL (spoofed/forwarded "http").
 */
export function isSecureRequest(request: Request): boolean {
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();

  let urlIsHttps = false;

  try {
    urlIsHttps = new URL(request.url).protocol === "https:";
  } catch {
    urlIsHttps = false;
  }

  return urlIsHttps || forwardedProto === "https";
}

export interface RequestAuthContext {
  activeOrgId?: string;
  isPlatformAdmin: boolean;
  mode: "browser-session" | "local-token";
  orgRole?: OrgRole;
  session?: StoredBrowserSessionRecord;
  user: Pick<StoredUserRecord, "id" | "email">;
}

function toAuthUser(user: StoredUserRecord): RequestAuthContext["user"] {
  return { email: user.email, id: user.id };
}

export function getRequestAuth(c: Context<AppEnv>): RequestAuthContext {
  const auth = c.get("auth");

  if (!auth) {
    throw new NakamaApiError("Authentication required", 401);
  }

  return auth;
}

export function isPendingMfaAllowedRequest(
  method: string,
  pathname: string
): boolean {
  return (
    (method === "GET" &&
      (pathname === "/v1/auth/me" ||
        pathname === "/v1/auth/orgs" ||
        pathname === "/v1/auth/sessions" ||
        pathname === "/v1/settings/mfa")) ||
    (method === "POST" &&
      (pathname === "/v1/auth/logout" ||
        pathname === "/v1/auth/mfa/totp/start" ||
        pathname === "/v1/auth/mfa/totp/verify" ||
        pathname === "/v1/auth/mfa/passkey/start" ||
        pathname === "/v1/auth/mfa/passkey/verify"))
  );
}

export async function isPendingBrowserMfa(
  auth: RequestAuthContext,
  databaseAdapter: DatabaseAdapter,
  orgId?: string | null
): Promise<boolean> {
  if (auth.mode !== "browser-session") {
    return false;
  }

  const user = await databaseAdapter.getUserById(auth.user.id);

  if (
    !user ||
    (user.mfaEnabled && user.mfaTotpSecretEnc) ||
    (await databaseAdapter.listPasskeys(user.id)).length > 0
  ) {
    return false;
  }

  const policy = await loadMfaPolicy();

  if (!(policy.enabled && policy.required)) {
    return false;
  }

  // Platform-admin authority outlives every organization membership, so a
  // required policy gates it on the account flag alone. Deriving this from the
  // active org role instead let a non-member admin drive /v1/platform/*
  // with nothing but a password.
  if (auth.isPlatformAdmin) {
    return true;
  }

  const activeOrgId =
    orgId?.trim() ||
    auth.activeOrgId?.trim() ||
    auth.session?.activeOrgId?.trim();

  if (!activeOrgId) {
    return false;
  }

  const role =
    auth.orgRole ??
    (await databaseAdapter.getOrgMember(activeOrgId, auth.user.id))?.role;

  return role ? policy.enforcedRoles.includes(role) : false;
}

export async function authenticateRequest(
  request: Request,
  authService: AuthService,
  databaseAdapter: DatabaseAdapter
): Promise<RequestAuthContext | null> {
  const authHeader = request.headers.get("Authorization");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const payload = await verifyLocalAuthToken(token);

    if (!payload) {
      return null;
    }

    let user = await databaseAdapter.getUserByEmail(payload.email);

    if (payload.email === LOCAL_CLIENT_EMAIL) {
      await ensureLocalClientAccess(databaseAdapter);
      user = await databaseAdapter.getUserByEmail(payload.email);
    }

    if (!user || user.disabledAt) {
      return null;
    }

    return {
      isPlatformAdmin: Boolean(user.isPlatformAdmin),
      mode: "local-token",
      user: toAuthUser(user),
    };
  }

  const sessionToken = getRequestTokenFromCookies(
    request,
    resolveBrowserSessionCookieNames(isSecureRequest(request)).session
  );

  if (!sessionToken) {
    const anthropicApiKey = request.headers.get("x-api-key")?.trim();

    if (anthropicApiKey) {
      const payload = await verifyLocalAuthToken(anthropicApiKey);

      if (payload) {
        let user = await databaseAdapter.getUserByEmail(payload.email);

        if (payload.email === LOCAL_CLIENT_EMAIL) {
          await ensureLocalClientAccess(databaseAdapter);
          user = await databaseAdapter.getUserByEmail(payload.email);
        }

        if (user && !user.disabledAt) {
          return {
            isPlatformAdmin: Boolean(user.isPlatformAdmin),
            mode: "local-token",
            user: toAuthUser(user),
          };
        }
      }
    }

    return null;
  }

  const sessionTokenHash = authService.hashToken(sessionToken);

  const session =
    await databaseAdapter.getBrowserSessionBySessionTokenHash(sessionTokenHash);

  if (!session || session.revokedAt) {
    return null;
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  const user = await databaseAdapter.getUserById(session.userId);

  if (!user || user.disabledAt) {
    return null;
  }

  await databaseAdapter.updateBrowserSessionLastUsedAt(
    session.id,
    new Date().toISOString()
  );

  return {
    isPlatformAdmin: Boolean(user.isPlatformAdmin),
    mode: "browser-session",
    session,
    user: toAuthUser(user),
  };
}

export function assertBrowserCsrf(
  request: Request,
  auth: RequestAuthContext,
  authService: AuthService
): void {
  if (auth.mode !== "browser-session" || !isMutatingMethod(request.method)) {
    return;
  }

  const csrfToken = getRequestTokenFromCookies(
    request,
    resolveBrowserSessionCookieNames(isSecureRequest(request)).csrf
  );

  const csrfHeader = request.headers.get(CSRF_HEADER_NAME);

  if (!(csrfToken && csrfHeader) || csrfToken !== csrfHeader.trim()) {
    throw new NakamaApiError("CSRF validation failed.", 403);
  }

  if (auth.session?.csrfTokenHash !== authService.hashToken(csrfToken)) {
    throw new NakamaApiError("CSRF validation failed.", 403);
  }
}

function applyBrowserSessionCookies(
  headers: Headers,
  sessionToken: string,
  csrfToken: string,
  request: Request
): void {
  const secure = isSecureRequest(request);
  const names = resolveBrowserSessionCookieNames(secure);

  const cookieBase = {
    path: "/",
    sameSite: "Lax" as const,
    secure,
  };

  appendSetCookie(
    headers,
    buildCookie(names.session, sessionToken, {
      ...cookieBase,
      httpOnly: true,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    })
  );

  appendSetCookie(
    headers,
    buildCookie(names.csrf, csrfToken, {
      ...cookieBase,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    })
  );

  if (secure) {
    // Drop the pre-migration unprefixed cookies so a host-only legacy cookie
    // stops shadowing the host-bound one after the upgrade.
    clearLegacyBrowserSessionCookies(headers);
  }
}

function clearLegacyBrowserSessionCookies(headers: Headers): void {
  // A browser matches a clear by name, domain and path, so one Secure clear
  // from an HTTPS response removes the cookie whichever Secure flag the
  // pre-migration copy was stored with.
  const cookieBase = {
    maxAge: 0,
    path: "/",
    sameSite: "Lax" as const,
    secure: true,
  };

  appendSetCookie(
    headers,
    buildCookie(LEGACY_COOKIE_NAMES.session, "", {
      ...cookieBase,
      httpOnly: true,
    })
  );
  appendSetCookie(
    headers,
    buildCookie(LEGACY_COOKIE_NAMES.csrf, "", { ...cookieBase })
  );
}

export async function createBrowserSessionResponse(
  authService: AuthService,
  databaseAdapter: DatabaseAdapter,
  user: StoredUserRecord,
  options: { activeOrgId?: string | null; request: Request }
): Promise<{
  body: { email: string };
  headers: Headers;
  session: StoredBrowserSessionRecord;
}> {
  const now = new Date().toISOString();
  const session = authService.createBrowserSessionTokens();

  const record: StoredBrowserSessionRecord = {
    activeOrgId: options.activeOrgId ?? null,
    createdAt: now,
    csrfTokenHash: authService.hashToken(session.csrfToken),
    expiresAt: session.expiresAt,
    id: crypto.randomUUID(),
    lastUsedAt: now,
    revokedAt: null,
    sessionTokenHash: authService.hashToken(session.sessionToken),
    userId: user.id,
  };

  await databaseAdapter.createBrowserSession(record);

  const headers = new Headers();
  applyBrowserSessionCookies(
    headers,
    session.sessionToken,
    session.csrfToken,
    options.request
  );

  return {
    body: { email: user.email },
    headers,
    session: record,
  };
}

export function clearBrowserSessionCookies(headers: Headers): void {
  const cookieBase = { maxAge: 0, path: "/", sameSite: "Lax" as const };

  // `__Host-` cookies are Secure by definition, and browsers ignore them on
  // http:// origins, so these clears are emitted unconditionally.
  appendSetCookie(
    headers,
    buildCookie(HOST_BOUND_COOKIE_NAMES.session, "", {
      ...cookieBase,
      httpOnly: true,
      secure: true,
    })
  );
  appendSetCookie(
    headers,
    buildCookie(HOST_BOUND_COOKIE_NAMES.csrf, "", {
      ...cookieBase,
      secure: true,
    })
  );

  // Clear both Secure and non-Secure variants so logout still works if the
  // Secure decision differs between login and logout (proxy header drift).
  for (const secure of [true, false] as const) {
    appendSetCookie(
      headers,
      buildCookie(LEGACY_COOKIE_NAMES.session, "", {
        ...cookieBase,
        httpOnly: true,
        secure,
      })
    );
    appendSetCookie(
      headers,
      buildCookie(LEGACY_COOKIE_NAMES.csrf, "", { ...cookieBase, secure })
    );
  }
}

/**
 * A cross-site form can POST text/plain without a CORS preflight, which is how a
 * malicious page can log a victim into an attacker's account. Requiring JSON
 * forces the preflight, and nothing here answers one.
 */
export function assertJsonRequest(request: Request): void {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    throw new NakamaApiError("Content-Type must be application/json.", 415);
  }
}

export async function readJson<T>(
  request: Request,
  schema?: ZodType<T>
): Promise<T> {
  try {
    const body = await request.json();

    if (!schema) {
      return body;
    }

    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      throw new NakamaApiError("Invalid request body.", 400);
    }

    return parsed.data;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new NakamaApiError("Invalid JSON in request body.", 400);
    }

    throw err;
  }
}

export function parseOptionalQueryEnum<const T extends string>(
  value: string | undefined,
  allowed: readonly T[]
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = allowed.find((candidate) => candidate === value);

  if (parsed !== undefined) {
    return parsed;
  }

  throw new NakamaApiError("Invalid query parameter.", 400);
}

export async function readOptionalJson<T>(
  request: Request,
  fallback: T,
  schema?: ZodType<T>
): Promise<T> {
  const body = await request.text();

  if (!body.trim()) {
    return fallback;
  }

  try {
    const value = JSON.parse(body);

    if (!schema) {
      return value;
    }

    const parsed = schema.safeParse(value);

    if (!parsed.success) {
      throw new NakamaApiError("Invalid request body.", 400);
    }

    return parsed.data;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new NakamaApiError("Invalid JSON in request body.", 400);
    }

    throw err;
  }
}

export function json<T>(body: T, status = 200, headers?: Headers): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");

  return Response.json(body, { headers: responseHeaders, status });
}

export function errorResponse(
  message: string,
  status: number,
  extra?: Omit<ApiErrorResponse, "error">
): Response {
  return Response.json(
    { error: message, ...extra } satisfies ApiErrorResponse,
    { status }
  );
}

/**
 * The page an OAuth provider's redirect lands on. A browser gets it, not a
 * client, so it answers HTML on success and on failure alike.
 */
export function oauthResultPage(
  title: string,
  detail: string,
  link: { href: string; label: string },
  status = 200
): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${Bun.escapeHTML(title)} - Nakama</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1.25rem; line-height: 1.5; color: #111; }
    h1 { font-size: 1.35rem; margin-bottom: 0.5rem; }
    p { color: #444; }
    a { color: #0b57d0; }
  </style>
</head>
<body>
  <h1>${Bun.escapeHTML(title)}</h1>
  <p>${Bun.escapeHTML(detail)}</p>
  <p><a href="${Bun.escapeHTML(link.href)}">${Bun.escapeHTML(link.label)}</a></p>
</body>
</html>`,
    {
      headers: { "Content-Type": "text/html; charset=utf-8" },
      status,
    }
  );
}

const CHANNEL_LIST = `${AGENT_CHANNELS.slice(0, -1).join(", ")}, or ${
  AGENT_CHANNELS[AGENT_CHANNELS.length - 1]
}`;

export function parseChannel(value: string | undefined): AgentChannel {
  const channel = AGENT_CHANNELS.find((candidate) => candidate === value);

  if (channel !== undefined) {
    return channel;
  }

  throw new NakamaApiError(`Invalid channel. Expected ${CHANNEL_LIST}.`, 400);
}

export function streamTurnSubscribe(sessionId: string): Response | null {
  if (!sessionTurnRegistry.isActive(sessionId)) {
    return null;
  }

  const encoder = new TextEncoder();
  const keepaliveIntervalMs = 4000;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const subscription = sessionTurnRegistry.subscribe(sessionId, (event) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );

          if (event.type === "done" || event.type === "error") {
            subscription?.unsubscribe();
            controller.close();
          }
        } catch {
          subscription?.unsubscribe();
        }
      });

      if (!subscription) {
        controller.close();

        return;
      }

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(keepalive);
          subscription.unsubscribe();
        }
      }, keepaliveIntervalMs);
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}

/**
 * SSE framing for a turn. Events written before `respond` wait in the stream,
 * and cancelling the response aborts `signal`, which stops the turn.
 */
export function createTurnStream() {
  const encoder = new TextEncoder();
  const cancel = new AbortController();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancel.abort();
    },
    start(streamController) {
      controller = streamController;
    },
  });

  const enqueue = (text: string) => {
    try {
      controller?.enqueue(encoder.encode(text));
    } catch {
      // The client went away. The turn keeps running for registry subscribers.
    }
  };

  return {
    onEvent: (event: StreamEvent) =>
      enqueue(`data: ${JSON.stringify(event)}\n\n`),
    respond(done: Promise<unknown>): Response {
      const keepalive = setInterval(() => enqueue(": ping\n\n"), 4000);

      void done.finally(() => {
        clearInterval(keepalive);

        try {
          controller?.close();
        } catch {
          // Already closed by the client cancelling the stream.
        }
      });

      return new Response(stream, {
        headers: {
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream; charset=utf-8",
        },
      });
    },
    signal: cancel.signal,
  };
}
