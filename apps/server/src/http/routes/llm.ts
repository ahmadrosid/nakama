import { z } from "@hono/zod-openapi";
import type {
  ChatCompletionResult,
  ChatMessage,
  GenerateChatInput,
  StreamChatHandlers,
} from "@nakama/core";
import { estimateChatInputBreakdown } from "../../providers/usage-tracking";
import {
  type ComputerAccess,
  computerTokenRequestSchema,
  isEd25519PublicKey,
  LLM_TOKEN_PATH,
} from "../../services/computer-auth";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireOrgMember,
  requirePlatformAdminFromContext,
} from "../org-guards";
import { getRequestAuth, readJson } from "../shared";
import type { HonoApp } from "../types";
import {
  capThinking,
  DESKTOP_CHAT_MAX_MS,
  DESKTOP_CHAT_UPLOAD_MS,
  failureOf,
  holdChatMemory,
  jsonValueSchema,
  readJsonWithin,
  replaySafe,
  withinTime,
} from "./llm-request-safety";

/** Output room held against the quota for one call, as the chat loop does. */
const RESERVED_OUTPUT_TOKENS = 32_000;

const toolCallSchema = z.object({
  arguments: z.record(z.string(), jsonValueSchema),
  id: z.string(),
  name: z.string(),
});

/**
 * Inline content only. A computer has no access to cloud attachments, so
 * image_ref and document_ref parts are refused.
 */
const contentPartSchema = z.discriminatedUnion("type", [
  z.object({ text: z.string(), type: z.literal("text") }),
  z.object({
    data: z.string(),
    description: z.string().optional(),
    mediaType: z.string(),
    type: z.literal("image"),
  }),
  z.object({
    data: z.string(),
    filename: z.string(),
    mediaType: z.string(),
    type: z.literal("document"),
  }),
]);

const chatMessageSchema = z.discriminatedUnion("role", [
  z.object({
    content: z.union([z.string(), z.array(contentPartSchema)]),
    role: z.literal("user"),
  }),
  z.object({
    content: z.string(),
    providerContent: z.array(jsonValueSchema).optional(),
    role: z.literal("assistant"),
    thinking: z.string().optional(),
    toolCalls: z.array(toolCallSchema).optional(),
  }),
  z.object({
    attachments: z.array(contentPartSchema).optional(),
    content: z.string(),
    name: z.string(),
    role: z.literal("tool"),
    toolCallId: z.string(),
  }),
]);

const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema),
  model: z.string().min(1).max(300),
  providerOptions: z
    .object({
      thinking: z
        .object({
          effort: z.enum(["low", "medium", "high"]).optional(),
          enabled: z.boolean(),
        })
        .optional(),
    })
    .optional(),
  system: z.string(),
  tools: z
    .array(
      z.object({
        description: z.string(),
        name: z.string(),
        parameters: z.record(z.string(), jsonValueSchema),
      })
    )
    .optional(),
});

const textRequestSchema = z.object({
  format: z.enum(["json", "text"]).optional(),
  model: z.string().min(1).max(300),
  prompt: z.string(),
  system: z.string(),
});

function passFrom(header: string | undefined): string | null {
  const match = header?.match(/^Bearer (\S+)$/);

  return match?.[1] ?? null;
}

type HandlerEvent<K extends keyof StreamChatHandlers> = Parameters<
  NonNullable<StreamChatHandlers[K]>
>[0];

/** One SSE frame of POST /v1/llm/chat. The desktop provider replays these. */
export type LlmStreamEvent =
  | { data: string; type: "chunk" | "thinking" }
  | { data: HandlerEvent<"onToolEnd">; type: "toolEnd" }
  | { data: HandlerEvent<"onToolInputDelta">; type: "toolInputDelta" }
  | { data: HandlerEvent<"onToolStart">; type: "toolStart" }
  | { data: ChatCompletionResult; type: "result" }
  | { data: { message: string; status: number }; type: "error" };

function asError(caught: Error | string): Error {
  return caught instanceof Error ? caught : new Error(caught);
}

/**
 * Model access for Nakama Desktop. There is no user session here: a computer
 * signs a request with its device key to get a pass, then sends the pass.
 */
export function registerLlmRoutes(app: HonoApp, options: ServerOptions): void {
  const { agent, computerAuth, databaseAdapter } = options;

  if (!computerAuth) {
    return;
  }

  /** The pass's computer, if it may use the org's models now. */
  const access = async (
    header: string | undefined
  ): Promise<
    { caller: ComputerAccess } | { error: string; status: 401 | 403 }
  > => {
    const pass = passFrom(header);
    const caller = pass ? await computerAuth.verifyPass(pass) : null;

    if (!caller) {
      return { error: "Sign in again.", status: 401 };
    }

    const org = await databaseAdapter?.getOrganizationById(caller.orgId);

    // No org found is no access, not a skipped check.
    if (!org || org.archivedAt) {
      return { error: "Sign in again.", status: 401 };
    }

    return org.desktopModelsEnabled === false
      ? {
          error: "Your team turned off Nakama Desktop for its models.",
          status: 403,
        }
      : { caller };
  };

  app.post(LLM_TOKEN_PATH, async (c) => {
    const request = computerTokenRequestSchema.safeParse(
      await readJson(c.req.raw, z.unknown())
    );

    const issued = request.success
      ? await computerAuth.issuePass(request.data, {
          method: "POST",
          path: LLM_TOKEN_PATH,
        })
      : null;

    if (issued && "pass" in issued) {
      return c.json(issued, 200);
    }

    // The server time lets a computer with a wrong clock sign again.
    return issued
      ? c.json({ error: "This computer's clock is off.", ...issued }, 401)
      : c.json({ error: "Sign in again." }, 401);
  });

  // Sign out on the computer: it removes itself.
  app.delete("/v1/llm/computer", async (c) => {
    const pass = passFrom(c.req.header("Authorization"));
    const caller = pass ? await computerAuth.verifyPass(pass) : null;

    if (!caller) {
      return c.json({ error: "Sign in again." }, 401);
    }

    await computerAuth.revoke({
      id: caller.computer.id,
      orgId: caller.orgId,
      userId: caller.userId,
    });

    return c.body(null, 204);
  });

  app.get("/v1/llm/models", async (c) => {
    const gate = await access(c.req.header("Authorization"));

    if ("error" in gate) {
      return c.json({ error: gate.error }, gate.status);
    }

    const { currentProviderId, models } = await agent.getModels();

    // Each provider marks its own default model. The team's default is the
    // one of the default provider; a desktop keeps one default only.
    return c.json(
      {
        models: models.map((model) => ({
          ...model,
          default: Boolean(
            model.default && model.providerId === currentProviderId
          ),
        })),
      },
      200
    );
  });

  app.post("/v1/llm/text", async (c) => {
    const gate = await access(c.req.header("Authorization"));

    if ("error" in gate) {
      return c.json({ error: gate.error }, gate.status);
    }

    const { caller } = gate;

    // The same memory share, upload time and call time as a chat.
    const freeMemory = holdChatMemory(
      caller.userId,
      c.req.header("content-length")
    );

    if (!freeMemory) {
      return c.json(
        { error: "Nakama Cloud is busy. Try again in a moment." },
        503
      );
    }

    let release: (() => Promise<void>) | undefined;

    try {
      const request = await readJsonWithin(
        c.req.raw,
        textRequestSchema,
        DESKTOP_CHAT_UPLOAD_MS
      );

      if (!request) {
        c.header("Connection", "close");

        return c.json({ error: "The request took too long to arrive." }, 408);
      }

      const { model, ...input } = request;
      const harness = await agent.desktopModelHarness({ ...caller, model });

      if (!harness) {
        return c.json(
          { error: "No model is set up for this organization." },
          503
        );
      }

      release = await harness.assertCanStart?.(
        Math.ceil((input.system.length + input.prompt.length) / 4) +
          RESERVED_OUTPUT_TOKENS
      );

      const result = await withinTime(
        harness.provider.generateText(input),
        DESKTOP_CHAT_MAX_MS
      );

      if (!result) {
        return c.json({ error: "The model took too long. Try again." }, 504);
      }

      // Titles and summaries are not chat turns, as on the web, but their
      // tokens count against the token limit.
      harness.recordUsage?.({
        estimated: !result.usage,
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        turns: 0,
      });

      return c.json(result, 200);
    } catch (error) {
      const failure = failureOf(
        error instanceof Error ? error : new Error(String(error))
      );

      return c.json({ error: failure.message }, failure.status);
    } finally {
      freeMemory();
      await release?.().catch(() => undefined);
    }
  });

  app.post("/v1/llm/chat", async (c) => {
    const gate = await access(c.req.header("Authorization"));

    if ("error" in gate) {
      return c.json({ error: gate.error }, gate.status);
    }

    const { caller } = gate;

    // Before the body is read: the room is held until the stream ends.
    // Per member, so more orgs or computers give no more room.
    const freeChatMemory = holdChatMemory(
      caller.userId,
      c.req.header("content-length")
    );

    if (!freeChatMemory) {
      return c.json(
        { error: "Nakama Cloud is busy. Try again in a moment." },
        503
      );
    }

    let streaming = false;

    try {
      // A body that trickles in is cancelled at the deadline, so it stops
      // filling memory before its room is given back.
      const request = await readJsonWithin(
        c.req.raw,
        chatRequestSchema,
        DESKTOP_CHAT_UPLOAD_MS
      );

      if (!request) {
        c.header("Connection", "close");

        return c.json({ error: "The request took too long to arrive." }, 408);
      }

      const { model, ...body } = request;
      const harness = await agent.desktopModelHarness({ ...caller, model });

      if (!harness) {
        return c.json(
          { error: "No model is set up for this organization." },
          503
        );
      }

      const abort = new AbortController();
      c.req.raw.signal.addEventListener("abort", () => abort.abort(), {
        once: true,
      });

      const input: GenerateChatInput = {
        // SAFETY: chatMessageSchema accepts only the inline shapes of ChatMessage.
        messages: body.messages.map((message) => {
          if (message.role !== "assistant" || !message.providerContent) {
            return message;
          }

          const { providerContent, ...rest } = message;
          const kept = replaySafe(providerContent);

          return kept.length > 0 ? { ...rest, providerContent: kept } : rest;
        }) as ChatMessage[],
        providerOptions: {
          ...harness.chatOptions,
          thinking: capThinking(
            body.providerOptions?.thinking,
            harness.chatOptions?.thinking
          ),
        },
        signal: abort.signal,
        system: body.system,
        tools: body.tools,
      };

      let release: (() => Promise<void>) | undefined;

      try {
        release = await harness.assertCanStart?.(
          estimateChatInputBreakdown(input).totalEstimatedInputTokens +
            RESERVED_OUTPUT_TOKENS
        );
      } catch (error) {
        const failure = failureOf(
          error instanceof Error ? error : new Error(String(error))
        );

        return c.json({ error: failure.message }, failure.status);
      }

      const encoder = new TextEncoder();

      // Each provider event goes out as it comes; nothing is kept here.
      const stream = new ReadableStream<Uint8Array>({
        cancel: () => abort.abort(),
        start: (controller) => {
          const send = (event: LlmStreamEvent) => {
            if (!abort.signal.aborted) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
              );
            }
          };

          let ended = false;

          // Once: when the provider settles, or at the deadline.
          const end = async (closeStream: boolean) => {
            if (ended) {
              return;
            }

            ended = true;
            clearTimeout(deadline);
            freeChatMemory();

            // A failed release must not leave the desktop waiting on the stream.
            await release?.().catch(() => undefined);

            if (closeStream) {
              controller.close();
            }
          };

          // A provider that never settles must not keep this call's memory
          // and quota hold, or the desktop's stream, forever.
          const deadline = setTimeout(() => {
            send({
              data: {
                message: "The model took too long. Try again.",
                status: 504,
              },
              type: "error",
            });
            void end(!abort.signal.aborted);
            abort.abort();
          }, DESKTOP_CHAT_MAX_MS);

          void harness.provider
            .streamChat(input, {
              onChunk: (data) => send({ data, type: "chunk" }),
              onThinking: (data) => send({ data, type: "thinking" }),
              onToolEnd: (data) => send({ data, type: "toolEnd" }),
              onToolInputDelta: (data) =>
                send({ data, type: "toolInputDelta" }),
              onToolStart: (data) => send({ data, type: "toolStart" }),
            })
            .then((data) => {
              // Count the call like a chat-loop step, so the org's limits hold.
              harness.recordUsage?.({
                estimated: Boolean(data.usage?.estimated ?? !data.usage),
                inputTokens: data.usage?.inputTokens ?? 0,
                outputTokens: data.usage?.outputTokens ?? 0,
              });
              send({ data, type: "result" });
            })
            .catch((error) =>
              send({ data: failureOf(asError(error)), type: "error" })
            )
            .finally(() => end(!abort.signal.aborted));
        },
      });

      streaming = true;

      return new Response(stream, {
        headers: {
          "cache-control": "no-cache",
          "content-type": "text/event-stream",
        },
      });
    } finally {
      // Returned before the stream: nothing holds the body any more.
      if (!streaming) {
        freeChatMemory();
      }
    }
  });
}

/** How fresh a browser sign-in must be to connect a computer. */
const RECENT_SIGN_IN_MS = 10 * 60 * 1000;

const enrollRequestSchema = z.object({
  installId: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(100),
  publicKey: z.string().refine(isEd25519PublicKey),
});

/**
 * The signed-in person's computers in the active org. The Connect page
 * enrolls one; Settings lists and removes them.
 */
export function registerComputerRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { computerAuth, databaseAdapter } = options;

  if (!computerAuth) {
    return;
  }

  const caller = (c: Parameters<typeof getRequestAuth>[0]) => {
    const auth = getRequestAuth(c);
    requireOrgMember(auth);

    return { orgId: requireActiveOrgIdFromContext(c), userId: auth.user.id };
  };

  app.post("/v1/computers", async (c) => {
    const { orgId, userId } = caller(c);
    const { mode, session } = getRequestAuth(c);

    // A computer is a sign-in that lasts. Only a browser sign-in from the
    // last few minutes may make one, so an old or stolen session cannot.
    const signedInAt =
      mode === "browser-session"
        ? Date.parse(session?.createdAt ?? "")
        : Number.NaN;

    if (!(Date.now() - signedInAt <= RECENT_SIGN_IN_MS)) {
      return c.json({ error: "Sign in again to connect this computer." }, 401);
    }

    const request = enrollRequestSchema.safeParse(
      await readJson(c.req.raw, z.unknown())
    );

    if (!request.success) {
      return c.json({ error: "Invalid request." }, 400);
    }

    // Say it on the Connect page, not after a sign-in that has no models.
    const org = await databaseAdapter?.getOrganizationById(orgId);

    if (org?.desktopModelsEnabled === false) {
      return c.json(
        { error: "Your team turned off Nakama Desktop for its models." },
        403
      );
    }

    const enrolled = await computerAuth.enroll({
      ...request.data,
      orgId,
      userId,
    });

    if (!enrolled) {
      return c.json(
        {
          error:
            "This computer is already connected. Remove it in Settings, then connect again.",
        },
        409
      );
    }

    return c.json(
      { computerId: enrolled.computer.id, confirmCode: enrolled.confirmCode },
      201
    );
  });

  app.get("/v1/computers", async (c) => {
    const { orgId, userId } = caller(c);
    const computers = await computerAuth.list({ orgId, userId });

    return c.json(
      {
        // An unconfirmed computer is not connected; it expires on its own.
        computers: computers
          .filter(
            (computer) => !(computer.revokedAt || computer.pendingCodeHash)
          )
          .map(({ createdAt, id, lastSeenAt, name }) => ({
            createdAt,
            id,
            lastSeenAt,
            name,
          })),
      },
      200
    );
  });

  app.delete("/v1/computers/:id", async (c) => {
    const { orgId, userId } = caller(c);

    const revoked = await computerAuth.revoke({
      id: c.req.param("id"),
      orgId,
      userId,
    });

    return revoked ? c.body(null, 204) : c.json({ error: "Not found." }, 404);
  });
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const signInRequestSchema = z.object({
  // HTTPS, or plain HTTP only to this computer: passes and prompts travel here.
  cloudUrl: z.url().refine((value) => {
    const url = new URL(value);

    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
    );
  }),
  computerName: z.string().trim().max(100).optional(),
});

/**
 * This computer's own sign-in to Nakama Cloud, used by the desktop app on its
 * local server. Local token or platform admin: it changes the providers.
 */
export function registerNakamaCloudSignInRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { agent } = options;

  // The desktop app calls with this computer's local token (a 0600 file).
  const requireThisComputer = (c: Parameters<typeof getRequestAuth>[0]) => {
    const auth = getRequestAuth(c);

    if (auth.mode !== "local-token") {
      requirePlatformAdminFromContext(c);
    }
  };

  app.get("/v1/nakama-cloud", (c) => {
    requireThisComputer(c);

    return c.json(agent.nakamaCloudStatus(), 200);
  });

  app.post("/v1/nakama-cloud/sign-in", async (c) => {
    requireThisComputer(c);

    const request = signInRequestSchema.safeParse(
      await readJson(c.req.raw, z.unknown())
    );

    if (!request.success) {
      return c.json({ error: "Enter the server address." }, 400);
    }

    return c.json(await agent.startNakamaCloudSignIn(request.data), 200);
  });

  app.delete("/v1/nakama-cloud", async (c) => {
    requireThisComputer(c);
    await agent.signOutNakamaCloud();

    return c.body(null, 204);
  });
}
