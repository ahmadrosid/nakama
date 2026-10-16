import { expect, test } from "bun:test";
import { writeFileTool } from "@nakama/core";
import { withMswCassette } from "../../testing/llm-msw-cassette";
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
