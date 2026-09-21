// Re-record with GEMINI_API_KEY and LLM_VCR_MODE=record; otherwise replay offline.
import { expect, test } from "bun:test";
import type { GenerateChatInput } from "@nakama/core";
import { withMswCassette } from "../../testing/llm-msw-cassette";
import { createGeminiProvider, toGeminiContents } from "./index";

test("Gemini resumes a signed tool turn after history serialization", async () => {
  const provider = createGeminiProvider({
    apiKey: process.env.GEMINI_API_KEY ?? "cassette-replay-key",
    model: "gemini-3.8-flash",
  });
  await withMswCassette(
    "gemini-signed-tool-continuation",
    async () => {
      const input: GenerateChatInput = {
        messages: [
          { content: "Read the probe and tell me its code.", role: "user" },
        ],
        signal: AbortSignal.timeout(45_000),
        system:
          "Call read_probe exactly once to get the secret code. After the tool result, reply with only the code returned by the tool. Never invent a code.",
        tools: [
          {
            description: "Read the secret probe code.",
            name: "read_probe",
            parameters: { properties: {}, type: "object" },
          },
        ],
      };
      const first = await provider.generateChat(input);
      expect(first.toolCalls).toHaveLength(1);
      expect(first.assistantMessage.providerContent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ thoughtSignature: expect.any(String) }),
        ])
      );
      const assistant = JSON.parse(JSON.stringify(first.assistantMessage));
      expect((await toGeminiContents([assistant]))[0]?.parts).toEqual(
        first.assistantMessage.providerContent
      );
      const call = first.toolCalls[0]!;
      const second = await provider.generateChat({
        ...input,
        messages: [
          ...input.messages,
          assistant,
          {
            content: JSON.stringify({ code: "PROBE-7319" }),
            name: call.name,
            role: "tool",
            toolCallId: call.id,
          },
        ],
        signal: AbortSignal.timeout(45_000),
      });
      expect(second.content).toBe("PROBE-7319");
      expect(second.toolCalls).toEqual([]);
    },
    {
      url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    }
  );
}, 120_000);
