import type { AgentChatSession } from "@nakama/agent";
import type { OrgRole } from "@nakama/core";
import {
  type AgentChannel,
  type AgentQuestionnaire,
  type AgentTodo,
  type ApiErrorResponse,
  formatServerError,
  LOCAL_CLIENT_EMAIL,
  NakamaApiError,
  resolveChatStreamTimeoutMs,
  type SendMessageInput,
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
import type { AuthService } from "../services/auth-service";
import { sessionTurnRegistry } from "../services/session-turn-registry";
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
function isSecureCookieRequest(request: Request): boolean {
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

export async function authenticateRequest(
  request: Request,
  authService: AuthService,
  databaseAdapter: DatabaseAdapter
): Promise<RequestAuthContext | null> {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const payload = await verifyLocalAuthToken(authHeader.slice(7).trim());
    if (!payload) {
      return null;
    }

    let user = await databaseAdapter.getUserByEmail(payload.email);
    if (payload.email === LOCAL_CLIENT_EMAIL) {
      await ensureLocalClientAccess(databaseAdapter);
      user = await databaseAdapter.getUserByEmail(payload.email);
    }
    if (!user) {
      return null;
    }

    return {
      isPlatformAdmin: Boolean(user.isPlatformAdmin),
      mode: "local-token",
      user: toAuthUser(user),
    };
  }

  const sessionToken = getRequestTokenFromCookies(request, SESSION_COOKIE_NAME);
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

        if (user) {
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
  if (!user) {
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

  const csrfToken = getRequestTokenFromCookies(request, CSRF_COOKIE_NAME);
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
  const cookieBase = {
    path: "/",
    sameSite: "Lax" as const,
    secure: isSecureCookieRequest(request),
  };

  appendSetCookie(
    headers,
    buildCookie(SESSION_COOKIE_NAME, sessionToken, {
      ...cookieBase,
      httpOnly: true,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    })
  );

  appendSetCookie(
    headers,
    buildCookie(CSRF_COOKIE_NAME, csrfToken, {
      ...cookieBase,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    })
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
  const cookieBase = {
    path: "/",
    sameSite: "Lax" as const,
  };

  // Clear both Secure and non-Secure variants so logout still works if the
  // Secure decision differs between login and logout (proxy header drift).
  for (const secure of [true, false] as const) {
    appendSetCookie(
      headers,
      buildCookie(SESSION_COOKIE_NAME, "", {
        ...cookieBase,
        httpOnly: true,
        maxAge: 0,
        secure,
      })
    );
    appendSetCookie(
      headers,
      buildCookie(CSRF_COOKIE_NAME, "", {
        ...cookieBase,
        maxAge: 0,
        secure,
      })
    );
  }
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

export function parseChannel(value: string | undefined): AgentChannel {
  if (
    value === "cli" ||
    value === "web" ||
    value === "telegram" ||
    value === "whatsapp" ||
    value === "discord" ||
    value === "automation" ||
    value === "task" ||
    value === "subagent"
  ) {
    return value;
  }

  throw new NakamaApiError(
    "Invalid channel. Expected cli, web, telegram, whatsapp, discord, automation, task, or subagent.",
    400
  );
}

const STREAM_TIMEOUT_MS = resolveChatStreamTimeoutMs();

function createStreamSenders(
  sessionId: string,
  enqueue: (chunk: Uint8Array) => void
): {
  send: (event: StreamEvent) => void;
  getTerminal: () => StreamEvent | null;
} {
  let terminal: StreamEvent | null = null;

  const send = (event: StreamEvent) => {
    sessionTurnRegistry.publish(sessionId, event);

    if (event.type === "done" || event.type === "error") {
      terminal = event;
    }

    try {
      enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      // Client disconnected — keep the server turn and registry subscribers alive.
    }
  };

  return {
    getTerminal: () => terminal,
    send,
  };
}

function buildAgentStreamHandlers(send: (event: StreamEvent) => void) {
  return {
    onChunk: (delta: string) => send({ delta, type: "chunk" }),
    onSubAgentActivity: (event: { parentToolCallId: string; label: string }) =>
      send({
        label: event.label,
        parentToolCallId: event.parentToolCallId,
        type: "sub_agent_activity",
      }),
    onThinking: (delta: string) => send({ delta, type: "thinking" }),
    onToolEnd: (event: {
      toolCallId: string;
      tool: string;
      result: unknown;
    }) => {
      send({
        result: event.result,
        tool: event.tool,
        toolCallId: event.toolCallId,
        type: "tool_end",
      });

      if (event.tool === "todo_write") {
        const todos = readTodosFromToolResult(event.result);

        if (todos) {
          send({ todos, type: "todos_updated" });
        }
      }

      if (event.tool === "ask_user_question") {
        const questionnaire = readQuestionnaireFromToolResult(event.result);

        if (questionnaire) {
          send({ questionnaire, type: "questionnaire_updated" });
        }
      }
    },
    onToolInputDelta: (event: {
      toolCallId: string;
      tool: string;
      delta: string;
      accumulatedArguments?: string;
    }) =>
      send({
        accumulatedArguments: event.accumulatedArguments,
        delta: event.delta,
        tool: event.tool,
        toolCallId: event.toolCallId,
        type: "tool_input_delta",
      }),
    onToolStart: (event: {
      toolCallId: string;
      tool: string;
      input: Record<string, unknown>;
    }) =>
      send({
        input: event.input,
        tool: event.tool,
        toolCallId: event.toolCallId,
        type: "tool_start",
      }),
  };
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

export function streamMessage(
  sessionId: string,
  session: AgentChatSession,
  input: SendMessageInput,
  onComplete?: (terminal: StreamEvent) => void,
  requestSignal?: AbortSignal
): Response {
  const encoder = new TextEncoder();
  const keepaliveIntervalMs = 4000;
  // The turn is cancelled either by the client going away (requestSignal, which is
  // what Discord /stop and a closed browser tab both look like here) or by the
  // response stream being cancelled. Both must reach the agent, otherwise the turn
  // runs to completion and endTurn is late, which is what returned 409 to the next
  // message in the session.
  const turnAbort = new AbortController();
  const turnSignal = requestSignal
    ? AbortSignal.any([turnAbort.signal, requestSignal])
    : turnAbort.signal;

  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      turnAbort.abort();
    },
    async start(controller) {
      const { send, getTerminal } = createStreamSenders(sessionId, (chunk) => {
        controller.enqueue(chunk);
      });

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(keepalive);
        }
      }, keepaliveIntervalMs);

      try {
        const reply = await Promise.race([
          session.sendStream(input, buildAgentStreamHandlers(send), {
            signal: turnSignal,
          }),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(
                new Error(
                  `Chat timed out after ${Math.round(STREAM_TIMEOUT_MS / 1000)}s waiting for the provider. Try another model or check provider settings.`
                )
              );
            }, STREAM_TIMEOUT_MS);
          }),
        ]);

        const contextUsage = session.getContextUsage() ?? undefined;
        send({
          reply,
          type: "done",
          ...(contextUsage ? { contextUsage } : {}),
        });
      } catch (error) {
        send({
          error: turnSignal.aborted
            ? "Turn cancelled."
            : formatServerError(error),
          type: "error",
        });
      } finally {
        clearInterval(keepalive);

        const terminal =
          getTerminal() ??
          ({
            error: "Stream closed before the agent finished.",
            type: "error",
          } satisfies StreamEvent);

        sessionTurnRegistry.endTurn(sessionId, terminal);
        try {
          controller.close();
        } catch {
          // Already closed by the client cancelling the stream.
        }
        onComplete?.(terminal);
      }
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
      content: record.content,
      id: record.id,
      status: record.status as AgentTodo["status"],
    });
  }

  return parsed;
}

function readQuestionnaireFromToolResult(
  result: unknown
): AgentQuestionnaire | null {
  if (
    typeof result !== "object" ||
    result === null ||
    !("questionnaire" in result)
  ) {
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
      allowCustomAnswer: question.allowCustomAnswer,
      choices: choices as AgentQuestionnaire["questions"][number]["choices"],
      id: question.id,
      placeholder:
        typeof question.placeholder === "string"
          ? question.placeholder
          : undefined,
      prompt: question.prompt,
    };
  });

  if (questions.some((question) => question === null)) {
    return null;
  }

  return {
    id: record.id,
    questions: questions as AgentQuestionnaire["questions"],
    title: record.title,
  };
}
