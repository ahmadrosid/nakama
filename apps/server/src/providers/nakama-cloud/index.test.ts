import { afterEach, expect, test } from "bun:test";
import {
  createPrivateKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { z } from "zod";
import {
  computerTokenPayload,
  LLM_TOKEN_PATH,
} from "../../services/computer-auth";
import { createNakamaCloudProvider, NakamaCloudPasses } from "./index";

const servers: Array<{ stop: (force?: boolean) => void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

const tokenBodySchema = z.object({
  computerId: z.string(),
  nonce: z.string(),
  signature: z.string(),
  timestamp: z.number(),
});

/** A fake cloud: checks the signature, hands out passes, streams a turn. */
function fakeCloud(options: { refuseTokens?: () => boolean; slow?: boolean }) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  const state = {
    chatAborted: false,
    issued: 0,
    validPass: "",
  };

  const server = Bun.serve({
    fetch: async (request) => {
      const { pathname } = new URL(request.url);

      if (pathname === LLM_TOKEN_PATH) {
        const body = tokenBodySchema.parse(await request.json());

        const signed = verify(
          null,
          computerTokenPayload(body, { method: "POST", path: LLM_TOKEN_PATH }),
          publicKey,
          Buffer.from(body.signature, "base64")
        );

        if (!signed || options.refuseTokens?.()) {
          return Response.json({ error: "Sign in again." }, { status: 401 });
        }

        state.issued += 1;
        state.validPass = `pass-${state.issued}`;

        return Response.json({
          expiresAt: Date.now() + 15 * 60 * 1000,
          pass: state.validPass,
        });
      }

      if (
        request.headers.get("authorization") !== `Bearer ${state.validPass}`
      ) {
        return Response.json({ error: "Sign in again." }, { status: 401 });
      }

      if (pathname === "/v1/llm/text") {
        return Response.json({ content: "A title" });
      }

      const frames = [
        { data: "Hel", type: "chunk" },
        { data: "lo", type: "chunk" },
        {
          data: {
            accumulatedArguments: "{",
            delta: "{",
            tool: "bash",
            toolCallId: "call_1",
          },
          type: "toolInputDelta",
        },
        {
          data: {
            assistantMessage: { content: "Hello", role: "assistant" },
            content: "Hello",
            toolCalls: [
              { arguments: { command: "ls" }, id: "call_1", name: "bash" },
            ],
          },
          type: "result",
        },
      ];

      const encoder = new TextEncoder();

      return new Response(
        new ReadableStream({
          cancel: () => {
            state.chatAborted = true;
          },
          start: (controller) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(frames[0])}\n\n`)
            );

            if (options.slow) {
              return;
            }

            for (const frame of frames.slice(1)) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)
              );
            }

            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } }
      );
    },
    port: 0,
  });

  servers.push(server);

  const passes = new NakamaCloudPasses({
    baseUrl: `http://127.0.0.1:${server.port}`,
    computerId: "computer_1",
    sign: async (payload) =>
      sign(
        null,
        payload,
        createPrivateKey(privateKey.export({ format: "pem", type: "pkcs8" }))
      ).toString("base64"),
  });

  const provider = createNakamaCloudProvider({
    baseUrl: `http://127.0.0.1:${server.port}`,
    model: "gpt-4o-mini",
    passes,
  });

  return { passes, provider, state };
}

const input = {
  messages: [{ content: "hi", role: "user" as const }],
  system: "You are helpful.",
};

test("a turn replays the cloud's events and returns its result, with one pass for two calls", async () => {
  const { provider, state } = fakeCloud({});
  const chunks: string[] = [];
  const deltas: string[] = [];

  const result = await provider.streamChat(input, {
    onChunk: (delta) => chunks.push(delta),
    onToolInputDelta: (event) => deltas.push(event.delta),
  });

  expect(chunks.join("")).toBe("Hello");
  expect(deltas).toEqual(["{"]);
  expect(result.toolCalls).toEqual([
    { arguments: { command: "ls" }, id: "call_1", name: "bash" },
  ]);

  expect(
    (await provider.generateText({ prompt: "Title?", system: "" })).content
  ).toBe("A title");
  expect(state.issued).toBe(1);
});

test("after a cloud restart the old pass fails once, and the provider gets a new one", async () => {
  const { provider, state } = fakeCloud({});

  await provider.generateText({ prompt: "x", system: "" });
  state.validPass = "pass-from-before-restart-is-gone";

  expect(
    (await provider.generateText({ prompt: "x", system: "" })).content
  ).toBe("A title");
  expect(state.issued).toBe(2);
});

test("a refused pass becomes Sign in again", async () => {
  let refuse = false;
  const { provider, state } = fakeCloud({ refuseTokens: () => refuse });

  await provider.generateText({ prompt: "x", system: "" });
  refuse = true;
  state.validPass = "revoked";

  await expect(
    provider.streamChat(input, { onChunk: () => undefined })
  ).rejects.toMatchObject({ status: 401 });
});

test("stopping a turn aborts the stream to the cloud", async () => {
  const { provider, state } = fakeCloud({ slow: true });
  const controller = new AbortController();
  const chunks: string[] = [];

  const turn = provider.streamChat(
    { ...input, signal: controller.signal },
    {
      onChunk: (delta) => {
        chunks.push(delta);
        controller.abort();
      },
    }
  );

  await expect(turn).rejects.toThrow();
  expect(chunks).toEqual(["Hel"]);

  for (let attempt = 0; attempt < 50 && !state.chatAborted; attempt += 1) {
    await Bun.sleep(10);
  }

  expect(state.chatAborted).toBe(true);
});
