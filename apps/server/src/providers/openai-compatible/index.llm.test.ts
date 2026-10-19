import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { writeFileTool } from "@nakama/core";
import {
  cassetteFilePath,
  withMswCassette,
} from "../../testing/llm-msw-cassette";
import { createOpenAICompatibleProvider } from "./index";

// Record with NETRA_API_KEY and LLM_VCR_MODE=record; replay is offline.
test("Netra writes complete HTML with the file tool schema", async () => {
  const content =
    "<!doctype html>\n<html><head><title>Harbor Launch</title></head>\n<body><h1>Harbor Launch</h1><p>Research: 12 hours.</p></body></html>\n";

  const provider = createOpenAICompatibleProvider({
    apiKey: process.env.NETRA_API_KEY ?? "cassette-replay-key",
    baseUrl: "https://api.netraruntime.com/v1",
    displayName: "Netra Runtime",
    model: "deepseek/deepseek-v4-flash-0731",
    providerName: "netra",
    supportsThinking: true,
  });

  const result = await withMswCassette(
    "netra-write-file-html",
    () =>
      provider.generateChat({
        messages: [
          {
            content: `Call write_file once with path artifacts/probe.html and content exactly this complete string: ${JSON.stringify(content)}`,
            role: "user",
          },
        ],
        providerOptions: { thinking: { enabled: false } },
        system: "Copy the complete file content without changes.",
        tools: [writeFileTool],
      }),
    { url: "https://api.netraruntime.com/v1/chat/completions" }
  );

  expect(result.toolCalls).toHaveLength(1);
  expect(result.toolCalls[0]?.name).toBe("write_file");
  expect(result.toolCalls[0]?.arguments).toMatchObject({
    content: expect.stringContaining(content.trim()),
    path: "artifacts/probe.html",
  });
});

// A missing cassette must not cause an implicit paid request in auto mode.
const v41Cassette = "netra-v41-tool-continuation";

const recordV41 = process.env.LLM_VCR_MODE === "record";

test.skipIf(
  recordV41
    ? !process.env.NETRA_API_KEY
    : !existsSync(cassetteFilePath(v41Cassette))
)(
  "Netra V4.1 completes a synthetic tool turn",
  async () => {
    const provider = createOpenAICompatibleProvider({
      apiKey: process.env.NETRA_API_KEY ?? "cassette-replay-key",
      baseUrl: "https://api.netraruntime.com/v1",
      displayName: "Netra Runtime",
      model: "deepseek/deepseek-v4.1-flash",
      providerName: "netra",
      supportsThinking: true,
    });

    const user = {
      content: "Call lookup once, then report its result.",
      role: "user" as const,
    };

    const options = {
      providerOptions: { thinking: { effort: "low" as const, enabled: true } },
      signal: AbortSignal.timeout(45_000),
      system:
        "Use the lookup tool. After the tool result, reply with only the result.",
      tools: [
        {
          description: "Return synthetic test data",
          name: "lookup",
          parameters: {
            additionalProperties: false,
            properties: {},
            type: "object",
          },
        },
      ],
    };

    await withMswCassette(
      v41Cassette,
      async () => {
        const first = await provider.generateChat({
          ...options,
          messages: [user],
        });

        expect(first.toolCalls).toHaveLength(1);
        const call = first.toolCalls[0]!;
        expect(call.name).toBe("lookup");
        expect(call.id.length).toBeGreaterThan(0);
        expect(call.arguments).toEqual({});

        const second = await provider.generateChat({
          ...options,
          messages: [
            user,
            first.assistantMessage,
            {
              content: "SYNTHETIC_OK_42",
              name: call.name,
              role: "tool",
              toolCallId: call.id,
            },
          ],
        });

        expect(second.toolCalls).toHaveLength(0);
        expect(second.content).toContain("SYNTHETIC_OK_42");
      },
      {
        mode: recordV41 ? "record" : "replay",
        url: "https://api.netraruntime.com/v1/chat/completions",
      }
    );
  },
  60_000
);
