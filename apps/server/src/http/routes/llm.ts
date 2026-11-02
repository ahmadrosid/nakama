import { z } from "@hono/zod-openapi";
import {
  type ChatCompletionResult,
  type ChatMessage,
  type GenerateChatInput,
  NakamaApiError,
  type StreamChatHandlers,
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

/** Output room held against the quota for one call, as the chat loop does. */
const RESERVED_OUTPUT_TOKENS = 32_000;

const jsonValueSchema = z.json();

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

interface Failure {
  message: string;
  status: 429 | 502;
}

function failureOf(error: Error): Failure {
  return error instanceof NakamaApiError && error.status === 429
    ? { message: "Your team's monthly limit is reached.", status: 429 }
    : { message: error.message || "The model call failed.", status: 502 };
}

function asError(caught: Error | string): Error {
  return caught instanceof Error ? caught : new Error(caught);
}

/**
 * Model access for Nakama Desktop. There is no user session here: a computer
 * signs a request with its device key to get a pass, then sends the pass.
 */
export function registerLlmRoutes(app: HonoApp, options: ServerOptions): void {
  const { agent, computerAuth } = options;

  if (!computerAuth) {
    return;
  }

  const access = (
    header: string | undefined
  ): Promise<ComputerAccess | null> => {
    const pass = passFrom(header);

    return pass ? computerAuth.verifyPass(pass) : Promise.resolve(null);
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

    return issued
      ? c.json(issued, 200)
      : c.json({ error: "Sign in again." }, 401);
  });

  app.get("/v1/llm/models", async (c) => {
    if (!(await access(c.req.header("Authorization")))) {
      return c.json({ error: "Sign in again." }, 401);
    }

    const { models } = await agent.getModels();

    return c.json({ models }, 200);
  });

  app.post("/v1/llm/text", async (c) => {
    const caller = await access(c.req.header("Authorization"));

    if (!caller) {
      return c.json({ error: "Sign in again." }, 401);
    }

    const request = textRequestSchema.safeParse(
      await readJson(c.req.raw, z.unknown())
    );

    if (!request.success) {
      return c.json({ error: "Invalid request." }, 400);
    }

    const { model, ...input } = request.data;
    const harness = await agent.desktopModelHarness({ ...caller, model });

    if (!harness) {
      return c.json(
        { error: "No model is set up for this organization." },
        503
      );
    }

    let release: (() => Promise<void>) | undefined;

    try {
      release = await harness.assertCanStart?.(
        Math.ceil((input.system.length + input.prompt.length) / 4) +
          RESERVED_OUTPUT_TOKENS
      );

      return c.json(await harness.provider.generateText(input), 200);
    } catch (error) {
      const failure = failureOf(
        error instanceof Error ? error : new Error(String(error))
      );

      return c.json({ error: failure.message }, failure.status);
    } finally {
      await release?.();
    }
  });

  app.post("/v1/llm/chat", async (c) => {
    const caller = await access(c.req.header("Authorization"));

    if (!caller) {
      return c.json({ error: "Sign in again." }, 401);
    }

    const request = chatRequestSchema.safeParse(
      await readJson(c.req.raw, z.unknown())
    );

    if (!request.success) {
      return c.json({ error: "Invalid request." }, 400);
    }

    const { model, ...body } = request.data;
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
      messages: body.messages as ChatMessage[],
      providerOptions: body.providerOptions ?? harness.chatOptions,
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

        void harness.provider
          .streamChat(input, {
            onChunk: (data) => send({ data, type: "chunk" }),
            onThinking: (data) => send({ data, type: "thinking" }),
            onToolEnd: (data) => send({ data, type: "toolEnd" }),
            onToolInputDelta: (data) => send({ data, type: "toolInputDelta" }),
            onToolStart: (data) => send({ data, type: "toolStart" }),
          })
          .then((data) => send({ data, type: "result" }))
          .catch((error) =>
            send({ data: failureOf(asError(error)), type: "error" })
          )
          .finally(async () => {
            await release?.();

            if (!abort.signal.aborted) {
              controller.close();
            }
          });
      },
    });

    return new Response(stream, {
      headers: {
        "cache-control": "no-cache",
        "content-type": "text/event-stream",
      },
    });
  });
}

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
  const { computerAuth } = options;

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

    const request = enrollRequestSchema.safeParse(
      await readJson(c.req.raw, z.unknown())
    );

    if (!request.success) {
      return c.json({ error: "Invalid request." }, 400);
    }

    const computer = await computerAuth.enroll({
      ...request.data,
      orgId,
      userId,
    });

    return c.json({ computerId: computer.id }, 201);
  });

  app.get("/v1/computers", async (c) => {
    const { orgId, userId } = caller(c);
    const computers = await computerAuth.list({ orgId, userId });

    return c.json(
      {
        computers: computers
          .filter((computer) => !computer.revokedAt)
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

const signInRequestSchema = z.object({
  cloudUrl: z.url(),
  computerName: z.string().trim().max(100).optional(),
});

/**
 * This computer's own sign-in to Nakama Cloud, used by the desktop app on its
 * local server. Platform admin only: it changes the install's providers.
 */
export function registerNakamaCloudSignInRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { agent } = options;

  app.get("/v1/nakama-cloud", (c) => {
    requirePlatformAdminFromContext(c);

    return c.json(agent.nakamaCloudStatus(), 200);
  });

  app.post("/v1/nakama-cloud/sign-in", async (c) => {
    requirePlatformAdminFromContext(c);

    const request = signInRequestSchema.safeParse(
      await readJson(c.req.raw, z.unknown())
    );

    if (!request.success) {
      return c.json({ error: "Enter the server address." }, 400);
    }

    return c.json(await agent.startNakamaCloudSignIn(request.data), 200);
  });

  app.delete("/v1/nakama-cloud", async (c) => {
    requirePlatformAdminFromContext(c);
    await agent.signOutNakamaCloud();

    return c.body(null, 204);
  });
}
