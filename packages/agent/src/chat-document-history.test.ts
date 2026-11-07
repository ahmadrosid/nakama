import { describe, expect, test } from "bun:test";
import {
  type ChatMessage,
  extractDocumentTextTool,
  type GenerateChatInput,
  type LoadedAttachmentBytes,
  type ProviderClient,
  persistInlineAttachmentsInContent,
  rehydrateMessagesForProvider,
  type ToolCall,
  type ToolDefinition,
} from "@nakama/core";
import { createAgentChatSession } from "./index";

const pdfBase64 = Buffer.from(
  "%PDF-1.4\n% nakama-1454 report body\n%%EOF\n"
).toString("base64");

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const extractTool: ToolDefinition = {
  description: "Extract document text",
  name: "extract_document_text",
  parameters: { properties: {}, type: "object" },
  run: () => Promise.resolve({ text: "report body" }),
};

const screenshotTool: ToolDefinition = {
  description: "Read an image",
  name: "read_file",
  parameters: { properties: {}, type: "object" },
  run: () =>
    Promise.resolve({
      content: "Read image",
      images: [{ data: tinyPngBase64, mediaType: "image/png" }],
      path: "/workspace/shot.png",
    }),
};

const readScreenshot: ToolCall = {
  arguments: { path: "shot.png" },
  id: "read1",
  name: "read_file",
};

function setup(
  tools: ToolDefinition[],
  scripted?: { call: ToolCall; onCall: number }
) {
  const calls: GenerateChatInput[] = [];
  const stored = new Map<string, LoadedAttachmentBytes>();

  const provider: ProviderClient = {
    generateChat(input) {
      calls.push(input);

      const toolCalls: ToolCall[] =
        calls.length === scripted?.onCall ? [scripted.call] : [];

      return Promise.resolve({
        assistantMessage: { content: "ok", role: "assistant", toolCalls },
        content: "ok",
        toolCalls,
      });
    },
    generateText: () => Promise.resolve({ content: "unused" }),
    name: "anthropic",
    streamChat(input) {
      return this.generateChat(input);
    },
  };

  const session = createAgentChatSession(
    { provider, tools },
    {
      preprocessUserContent: (content) =>
        persistInlineAttachmentsInContent(content, async (input) => {
          const attachmentId = `att_${stored.size + 1}`;
          stored.set(attachmentId, {
            bytes: input.bytes,
            filename: input.filename,
            mediaType: input.mediaType,
          });

          return { attachmentId, size: input.bytes.length };
        }),
      rehydrateMessagesForProvider: (messages, options) =>
        rehydrateMessagesForProvider(
          messages,
          async (attachmentId) => stored.get(attachmentId) ?? null,
          options
        ),
      toolContext: {
        loadAttachment: async (attachmentId) =>
          stored.get(attachmentId) ?? null,
      },
    }
  );

  return { calls, session };
}

function sends(messages: ChatMessage[], base64: string): boolean {
  return JSON.stringify(messages).includes(base64);
}

function attach(data: string, filename: string, mediaType: string) {
  return { documents: [{ data, filename, mediaType }], message: "Read this" };
}

const attachPdf = attach(pdfBase64, "report.pdf", "application/pdf");

describe("documents from earlier turns", () => {
  test("are sent in full only on the turn they were attached", async () => {
    const { calls, session } = setup([extractTool]);

    await session.send("Hello");
    await session.send(attachPdf);
    await session.send("What was the total?");
    await session.send("And the date?");

    expect(calls.map((call) => sends(call.messages, pdfBase64))).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  test("stay in full after a tool returns an image in the same turn", async () => {
    const { calls, session } = setup([extractTool, screenshotTool], {
      call: readScreenshot,
      onCall: 1,
    });

    await session.send(attachPdf);

    expect(calls).toHaveLength(2);
    expect(sends(calls[1]!.messages, tinyPngBase64)).toBe(true);
    expect(calls.map((call) => sends(call.messages, pdfBase64))).toEqual([
      true,
      true,
    ]);
  });

  test("stay in full when the profile cannot reopen them", async () => {
    const { calls, session } = setup([]);

    await session.send(attachPdf);
    await session.send("What was the total?");

    expect(calls.map((call) => sends(call.messages, pdfBase64))).toEqual([
      true,
      true,
    ]);
  });

  test.each([
    ["notes.txt", "text/plain"],
    ["data.csv", "text/csv"],
    ["readme.md", "text/markdown"],
  ])("can be reopened when they are %s", async (filename, mediaType) => {
    const { calls, session } = setup([extractDocumentTextTool], {
      call: {
        arguments: { documentRef: "att_1" },
        id: "extract1",
        name: "extract_document_text",
      },
      onCall: 2,
    });

    const notes = "nakama-1454 notes";
    const notesBase64 = Buffer.from(notes).toString("base64");

    await session.send(attach(notesBase64, filename, mediaType));
    await session.send("What does it say?");

    expect(calls.map((call) => sends(call.messages, notesBase64))).toEqual([
      true,
      false,
      false,
    ]);

    const toolReply = calls[2]?.messages.find(
      (message) => message.role === "tool"
    );

    expect(toolReply?.content).toContain(notes);
    expect(toolReply?.content).not.toContain('"error"');
  });
});
