import type { OrgRole } from "@nakama/core";
import {
  formatServerError,
  LOCAL_CLIENT_EMAIL,
  NakamaApiError,
  type AgentChannel,
  type AgentQuestionnaire,
  type AgentTodo,
  type ApiErrorResponse,
  type SendMessageInput,
  type StreamEvent,
  verifyLocalAuthToken,
} from "@nakama/core";
import type { AgentChatSession } from "@nakama/agent";
import type { Context } from "hono";
import type { AuthService } from "../services/auth-service";
import type {
  DatabaseAdapter,
  StoredBrowserSessionRecord,
  StoredUserRecord,
} from "@nakama/db";
import { ensureLocalClientAccess } from "@nakama/db";
import type { AppEnv } from "./types";

const SESSION_COOKIE_NAME = "nakama_session";
const CSRF_COOKIE_NAME = "nakama_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";
const SESSION_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function parseCookies(header: string | null): Record<string, string> {
  if (!header) {
    return {};
  }

  const cookies: Record<string, string> = {};

  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (!name || rest.length === 0) {
      continue;
    }

    cookies[name] = rest.join("=");
  }

  return cookies;
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
  } = {},
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

function getRequestTokenFromCookies(request: Request, name: string): string | null {
  const cookies = parseCookies(request.headers.get("Cookie"));
  return cookies[name]?.trim() || null;
}

function isMutatingMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function isSecureCookieRequest(): boolean {
  return process.env.NODE_ENV === "production";
}

export interface RequestAuthContext {
  mode: "browser-session" | "local-token";
  user: Pick<StoredUserRecord, "id" | "email">;
  session?: StoredBrowserSessionRecord;
  isPlatformAdmin: boolean;
  activeOrgId?: string;
  orgRole?: OrgRole;
}

function toAuthUser(user: StoredUserRecord): RequestAuthContext["user"] {
  return { id: user.id, email: user.email };
}

export function getRequestAuth(c: Context<AppEnv>): RequestAuthContext {
  const auth = c.get("auth");
  if (!auth) {
    throw new NakamaApiError("Authentication required", 401);
  }

  return auth;
}

export async function authenticateRequest(
  request: Request,
  authService: AuthService,
  databaseAdapter: DatabaseAdapter,
): Promise<RequestAuthContext | null> {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const payload = await verifyLocalAuthToken(authHeader.slice(7).trim());
    if (!payload) {
      return null;
    }

    let user = await databaseAdapter.getUserByEmail(payload.email);
    if (!user && payload.email === LOCAL_CLIENT_EMAIL) {
      await ensureLocalClientAccess(databaseAdapter);
      user = await databaseAdapter.getUserByEmail(payload.email);
    }
    if (!user) {
      return null;
    }

    return {
      mode: "local-token",
      user: toAuthUser(user),
      isPlatformAdmin: Boolean(user.isPlatformAdmin),
    };
  }

  const sessionToken = getRequestTokenFromCookies(request, SESSION_COOKIE_NAME);
  if (!sessionToken) {
    const anthropicApiKey = request.headers.get("x-api-key")?.trim();

    if (anthropicApiKey) {
      const payload = await verifyLocalAuthToken(anthropicApiKey);

      if (payload) {
        let user = await databaseAdapter.getUserByEmail(payload.email);

        if (!user && payload.email === LOCAL_CLIENT_EMAIL) {
          await ensureLocalClientAccess(databaseAdapter);
          user = await databaseAdapter.getUserByEmail(payload.email);
        }

        if (user) {
          return {
            mode: "local-token",
            user: toAuthUser(user),
            isPlatformAdmin: Boolean(user.isPlatformAdmin),
          };
        }
      }
    }

    return null;
  }

  const sessionTokenHash = authService.hashToken(sessionToken);
  const session = await databaseAdapter.getBrowserSessionBySessionTokenHash(sessionTokenHash);
  if (!session || session.revokedAt) {
    return null;
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  const user = await databaseAdapter.getUserById(session.userId);
  if (!user) {
    return null;
  }

  await databaseAdapter.updateBrowserSessionLastUsedAt(session.id, new Date().toISOString());

  return {
    mode: "browser-session",
    user: toAuthUser(user),
    session,
    isPlatformAdmin: Boolean(user.isPlatformAdmin),
  };
}

export function assertBrowserCsrf(
  request: Request,
  auth: RequestAuthContext,
  authService: AuthService,
): void {
  if (auth.mode !== "browser-session" || !isMutatingMethod(request.method)) {
    return;
  }

  const csrfToken = getRequestTokenFromCookies(request, CSRF_COOKIE_NAME);
  const csrfHeader = request.headers.get(CSRF_HEADER_NAME);

  if (!csrfToken || !csrfHeader || csrfToken !== csrfHeader.trim()) {
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
): void {
  const cookieBase = {
    path: "/",
    sameSite: "Lax" as const,
    secure: isSecureCookieRequest(),
  };

  appendSetCookie(
    headers,
    buildCookie(SESSION_COOKIE_NAME, sessionToken, {
      ...cookieBase,
      httpOnly: true,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    }),
  );

  appendSetCookie(
    headers,
    buildCookie(CSRF_COOKIE_NAME, csrfToken, {
      ...cookieBase,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    }),
  );
}

export async function createBrowserSessionResponse(
  authService: AuthService,
  databaseAdapter: DatabaseAdapter,
  user: StoredUserRecord,
  options: { activeOrgId?: string | null } = {},
): Promise<{
  body: { email: string };
  headers: Headers;
  session: StoredBrowserSessionRecord;
}> {
  const now = new Date().toISOString();
  const session = authService.createBrowserSessionTokens();
  const record: StoredBrowserSessionRecord = {
    id: crypto.randomUUID(),
    userId: user.id,
    sessionTokenHash: authService.hashToken(session.sessionToken),
    csrfTokenHash: authService.hashToken(session.csrfToken),
    activeOrgId: options.activeOrgId ?? null,
    createdAt: now,
    expiresAt: session.expiresAt,
    revokedAt: null,
    lastUsedAt: now,
  };

  await databaseAdapter.createBrowserSession(record);

  const headers = new Headers();
  applyBrowserSessionCookies(headers, session.sessionToken, session.csrfToken);

  return {
    body: { email: user.email },
    headers,
    session: record,
  };
}

export function clearBrowserSessionCookies(headers: Headers): void {
  const cookieBase = {
    path: "/",
    sameSite: "Lax" as const,
    secure: isSecureCookieRequest(),
  };

  appendSetCookie(
    headers,
    buildCookie(SESSION_COOKIE_NAME, "", {
      ...cookieBase,
      httpOnly: true,
      maxAge: 0,
    }),
  );

  appendSetCookie(
    headers,
    buildCookie(CSRF_COOKIE_NAME, "", {
      ...cookieBase,
      maxAge: 0,
    }),
  );
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
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
  return Response.json(body, { status, headers: responseHeaders });
}

export function errorResponse(
  message: string,
  status: number,
  extra?: Omit<ApiErrorResponse, "error">,
): Response {
  return Response.json({ error: message, ...extra } satisfies ApiErrorResponse, { status });
}

export function parseChannel(value: string | undefined): AgentChannel {
  if (value === "cli" || value === "web" || value === "telegram" || value === "whatsapp") {
    return value;
  }

  throw new NakamaApiError("Invalid channel. Expected cli, web, or telegram.", 400);
}

const STREAM_TIMEOUT_MS = 120_000;

export function streamMessage(
  session: AgentChatSession,
  input: SendMessageInput,
  onComplete?: () => void,
): Response {
  const encoder = new TextEncoder();
  const keepaliveIntervalMs = 4_000;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(keepalive);
        }
      }, keepaliveIntervalMs);

      try {
        const reply = await Promise.race([
          session.sendStream(input, {
            onChunk: (delta) => send({ type: "chunk", delta }),
            onThinking: (delta) => send({ type: "thinking", delta }),
            onToolStart: (event) =>
              send({
                type: "tool_start",
                toolCallId: event.toolCallId,
                tool: event.tool,
                input: event.input,
              }),
            onToolEnd: (event) => {
              send({
                type: "tool_end",
                toolCallId: event.toolCallId,
                tool: event.tool,
                result: event.result,
              });

              if (event.tool === "todo_write") {
                const todos = readTodosFromToolResult(event.result);

                if (todos) {
                  send({ type: "todos_updated", todos });
                }
              }

              if (event.tool === "ask_user_question") {
                const questionnaire = readQuestionnaireFromToolResult(event.result);

                if (questionnaire) {
                  send({ type: "questionnaire_updated", questionnaire });
                }
              }
            },
          }),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(
                new Error(
                  `Chat timed out after ${Math.round(STREAM_TIMEOUT_MS / 1000)}s waiting for the provider. Try another model or check provider settings.`,
                ),
              );
            }, STREAM_TIMEOUT_MS);
          }),
        ]);

        send({ type: "done", reply });
      } catch (error) {
        send({ type: "error", error: formatServerError(error) });
      } finally {
        clearInterval(keepalive);
        controller.close();
        onComplete?.();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function readTodosFromToolResult(result: unknown): AgentTodo[] | null {
  if (typeof result !== "object" || result === null || !("todos" in result)) {
    return null;
  }

  const todos = (result as { todos?: unknown }).todos;

  if (!Array.isArray(todos)) {
    return null;
  }

  const parsed: AgentTodo[] = [];

  for (const item of todos) {
    if (typeof item !== "object" || item === null) {
      return null;
    }

    const record = item as Record<string, unknown>;

    if (
      typeof record.id !== "string" ||
      typeof record.content !== "string" ||
      typeof record.status !== "string"
    ) {
      return null;
    }

    parsed.push({
      id: record.id,
      content: record.content,
      status: record.status as AgentTodo["status"],
    });
  }

  return parsed;
}

function readQuestionnaireFromToolResult(result: unknown): AgentQuestionnaire | null {
  if (typeof result !== "object" || result === null || !("questionnaire" in result)) {
    return null;
  }

  const questionnaire = (result as { questionnaire?: unknown }).questionnaire;

  if (typeof questionnaire !== "object" || questionnaire === null) {
    return null;
  }

  const record = questionnaire as Record<string, unknown>;

  if (
    typeof record.id !== "string" ||
    typeof record.title !== "string" ||
    !Array.isArray(record.questions)
  ) {
    return null;
  }

  const questions = record.questions.map((item) => {
    if (typeof item !== "object" || item === null) {
      return null;
    }

    const question = item as Record<string, unknown>;

    if (
      typeof question.id !== "string" ||
      typeof question.prompt !== "string" ||
      typeof question.allowCustomAnswer !== "boolean" ||
      !Array.isArray(question.choices)
    ) {
      return null;
    }

    const choices = question.choices.map((choice) => {
      if (typeof choice !== "object" || choice === null) {
        return null;
      }

      const value = choice as Record<string, unknown>;

      if (typeof value.id !== "string" || typeof value.label !== "string") {
        return null;
      }

      return { id: value.id, label: value.label };
    });

    if (choices.some((choice) => choice === null)) {
      return null;
    }

    return {
      id: question.id,
      prompt: question.prompt,
      allowCustomAnswer: question.allowCustomAnswer,
      placeholder:
        typeof question.placeholder === "string" ? question.placeholder : undefined,
      choices: choices as AgentQuestionnaire["questions"][number]["choices"],
    };
  });

  if (questions.some((question) => question === null)) {
    return null;
  }

  return {
    id: record.id,
    title: record.title,
    questions: questions as AgentQuestionnaire["questions"],
  };
}
