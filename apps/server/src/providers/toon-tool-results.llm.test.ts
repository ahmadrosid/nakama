import { expect, test } from "bun:test";
import type { ChatMessage } from "@nakama/core";
import { z } from "zod";
import { generateOpenAIResponsesChat } from "./openai";
import { withMswCassette } from "../testing/llm-msw-cassette";

// Replay-only cassette test for #2101: no provider network, no credentials.
// The cassette answers from tape; matchRequest proves the live request carried
// the search results as TOON (not JSON) when NAKAMA_TOON_TOOL_RESULTS=1.
const SEARCH_RESULTS = JSON.stringify([
  {
    file: "apps/platform/slack/src/index.ts",
    line: 185,
    text: "handleEvent(event).catch((error) => {",
  },
  {
    file: "apps/platform/slack/src/chat-handler.ts",
    line: 42,
    text: "export function createChatHandler(deps: ChatHandlerDeps) {",
  },
]);

const messages: ChatMessage[] = [
  { content: "Which files mention handleEvent?", role: "user" },
  {
    content: "",
    role: "assistant",
    toolCalls: [
      {
        arguments: { query: "handleEvent" },
        id: "call_1",
        name: "search_files",
      },
    ],
  },
  { content: SEARCH_RESULTS, role: "tool", toolCallId: "call_1" },
];

function requestCarriesToonSearchResults(actual: unknown): boolean {
  const body = z
    .object({ input: z.array(z.object({}).passthrough()).optional() })
    .passthrough()
    .safeParse(actual);

  if (!body.success) {
    return false;
  }

  const output = body.data.input?.find(
    (item) =>
      (item as { type?: string }).type === "function_call_output"
  ) as { output?: unknown } | undefined;

  return (
    typeof output?.output === "string" &&
    output.output !== SEARCH_RESULTS &&
    output.output.includes("file,line,text") &&
    output.output.includes("apps/platform/slack/src/index.ts")
  );
}

test("model answers from TOON search results", async () => {
  const previous = process.env.NAKAMA_TOON_TOOL_RESULTS;
  process.env.NAKAMA_TOON_TOOL_RESULTS = "1";

  try {
    const result = await withMswCassette(
      "toon-tool-results",
      () =>
        generateOpenAIResponsesChat({
          apiKey: "test",
          input: { messages, system: "s" },
          model: "gpt-5.4",
          stream: false,
        }),
      {
        matchRequest: (actual) => requestCarriesToonSearchResults(actual),
        mode: "replay",
        url: "https://api.openai.com/v1/responses",
      }
    );

    expect(result.content).toContain("apps/platform/slack/src/index.ts");
  } finally {
    if (previous === undefined) {
      delete process.env.NAKAMA_TOON_TOOL_RESULTS;
    } else {
      process.env.NAKAMA_TOON_TOOL_RESULTS = previous;
    }
  }
});
