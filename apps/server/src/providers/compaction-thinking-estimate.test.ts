import { describe, expect, mock, test } from "bun:test";
import type { ChatMessage, ProviderClient } from "@nakama/core";
// estimateHistoryTokens is not exported from @nakama/agent, hence the deep path.
import {
  compactHistory,
  estimateHistoryTokens,
  providerReplaysThinking,
} from "../../../../packages/agent/src/history-compaction";
import { createGeminiProvider, toGeminiContents } from "./gemini";
import { createOpenAIProvider, toOpenAIMessages } from "./openai";

const j = (value: unknown) => JSON.stringify(value);

// Mirrors TOKEN_ESTIMATE_RATIO = 4 in history-compaction.ts.
const estimateTokens = (text: string) => Math.ceil(text.length / 4);

const REASONING = "The user wants last quarter invoices. ".repeat(20);
const USER: ChatMessage = { content: "invoices last quarter", role: "user" };

function eventStream(chunks: string[]): Response {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" }, status: 200 }
  );
}

const chunk = (delta: Record<string, unknown>) =>
  `data: ${j({ choices: [{ delta }] })}\n\n`;

// deepseek, xai, minimax, zhipu, and opencode_go all reach createOpenAIProvider
// with a providerName other than "openai", so every request stays on
// /chat/completions and the turn is built by buildChatCompletionResult.
async function chatCompletionsTurn(): Promise<ChatMessage> {
  const fetchMock = mock(async () =>
    eventStream([
      chunk({ reasoning_content: REASONING }),
      chunk({ content: "Let me look that up." }),
      "data: [DONE]\n\n",
    ])
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  try {
    const provider = createOpenAIProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-reasoner",
      providerName: "deepseek",
    });
    const { assistantMessage } = await provider.streamChat(
      { messages: [USER], system: "" },
      { onChunk: () => undefined }
    );

    return assistantMessage;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("history token estimate on the chat-completions path", () => {
  test("does not under-count a turn whose reasoning is replayed", async () => {
    const assistant = await chatCompletionsTurn();
    const replays = providerReplaysThinking("deepseek");
    const estimated =
      estimateHistoryTokens([USER, assistant], "", [], replays) -
      estimateHistoryTokens([USER], "", [], replays);
    const sent =
      estimateTokens(j(await toOpenAIMessages("", [USER, assistant]))) -
      estimateTokens(j(await toOpenAIMessages("", [USER])));

    expect({
      estimated,
      sent,
      withinTenPercent: estimated / sent >= 0.9,
    }).toEqual({ estimated, sent, withinTenPercent: true });
  });

  test("summarizes once the replayed reasoning has overflowed", async () => {
    const history: ChatMessage[] = [];

    for (let turn = 0; turn < 6; turn += 1) {
      history.push({ content: `turn ${turn}`, role: "user" });
      history.push(await chatCompletionsTurn());
    }

    let summarizeCalls = 0;
    const provider: ProviderClient = {
      generateChat() {
        summarizeCalls += 1;
        return Promise.resolve({
          assistantMessage: { content: "summary", role: "assistant" },
          content: "summary",
          toolCalls: [],
        });
      },
      generateText() {
        return Promise.resolve({ content: "summary" });
      },
      name: "deepseek",
      streamChat(input, handlers) {
        handlers.onChunk("summary");
        return this.generateChat(input);
      },
    };

    const sent = estimateTokens(j(await toOpenAIMessages("", history)));
    const result = await compactHistory({
      compaction: { contextWindow: 1000, maxOutputTokens: 100 },
      history,
      provider,
      systemPrompt: "",
    });

    expect({
      action: result.action,
      alreadyOverflowed: sent >= 900,
      summarizeCalls,
    }).toEqual({
      action: "summarized",
      alreadyOverflowed: true,
      summarizeCalls: 1,
    });
  });
});

// The Gemini parser keeps thought parts as message.thinking, but
// toGeminiAssistantParts never sends them back.
async function geminiTurn(): Promise<ChatMessage> {
  const body = JSON.stringify({
    candidates: [
      {
        content: {
          parts: [{ text: REASONING, thought: true }, { text: "Answer." }],
          role: "model",
        },
        finishReason: "STOP",
      },
    ],
  });
  const fetchMock = mock(
    async () =>
      new Response(body, {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  try {
    const provider = createGeminiProvider({
      apiKey: "k",
      model: "gemini-3-pro",
    });
    const result = await provider.generateChat({
      messages: [USER],
      system: "",
    });

    return result.assistantMessage;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("history token estimate on the Gemini path", () => {
  test("does not over-count a trace the Gemini mapper drops", async () => {
    const assistant = await geminiTurn();

    const replays = providerReplaysThinking("gemini");
    const estimated =
      estimateHistoryTokens([USER, assistant], "", [], replays) -
      estimateHistoryTokens([USER], "", [], replays);
    const sent =
      estimateTokens(j(await toGeminiContents([USER, assistant]))) -
      estimateTokens(j(await toGeminiContents([USER])));

    expect({
      estimated,
      sent,
      withinTenPercent: estimated / sent <= 1.1,
    }).toEqual({
      estimated,
      sent,
      withinTenPercent: true,
    });
  });

  // Eight turns is what it takes for the trace alone to push the estimate over
  // the window: counted, this history reads 945 against a usable 900 and is
  // summarized; uncounted it reads 105.
  test("does not summarize a Gemini history on a trace it never sends", async () => {
    const history: ChatMessage[] = [];

    for (let turn = 0; turn < 8; turn += 1) {
      history.push({ content: `turn ${turn}`, role: "user" });
      history.push(await geminiTurn());
    }

    let summarizeCalls = 0;
    const provider: ProviderClient = {
      generateChat() {
        summarizeCalls += 1;
        return Promise.resolve({
          assistantMessage: { content: "summary", role: "assistant" },
          content: "summary",
          toolCalls: [],
        });
      },
      generateText() {
        return Promise.resolve({ content: "summary" });
      },
      name: "gemini",
      streamChat(input, handlers) {
        handlers.onChunk("summary");
        return this.generateChat(input);
      },
    };

    const sent = estimateTokens(j(await toGeminiContents(history)));
    const result = await compactHistory({
      compaction: { contextWindow: 1000, maxOutputTokens: 100 },
      history,
      provider,
      systemPrompt: "",
    });

    expect({
      action: result.action,
      stillFitsTheWindow: sent < 900,
      summarizeCalls,
    }).toEqual({ action: "none", stillFitsTheWindow: true, summarizeCalls: 0 });
  });
});
