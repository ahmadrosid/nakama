import { expect, spyOn, test } from "bun:test";
import { NakamaClient } from "@nakama/client";
import type { ModelsResponse, ProfileSummary } from "@nakama/core";
import { runChat } from "./chat";
import * as clipboard from "./clipboard-image";
import * as imageInput from "./image-input";
import type { PendingMessage } from "./message-queue";
import * as profile from "./profile";
import { styledLineText } from "./styled-text";
import { TerminalInput } from "./terminal-input";
import { TerminalRenderer } from "./terminal-renderer";

test.each(["success", "failure", "interrupted", "thinking"])(
  "keeps completed tool batches on separate lines: %s",
  async (outcome) => {
    const selected = {
      id: "test",
      model: null,
      name: "Test",
    } as ProfileSummary;
    const client = new NakamaClient();
    const session = client.createChatSession("test", "cli");
    const ready = Promise.withResolvers<(chunk: string) => void>();
    const finished = Promise.withResolvers<void>();
    const exit = new AbortController();
    const lines: string[] = [];
    let status = "";
    const states: string[] = [];
    const completedBatches: string[][] = [];
    const spies = [
      spyOn(profile, "resolveStartupProfile").mockResolvedValue({
        profile: selected,
        profileId: selected.id,
      }),
      spyOn(client, "listProfiles").mockResolvedValue({ profiles: [selected] }),
      spyOn(client, "createSession").mockResolvedValue(session),
      spyOn(TerminalRenderer.prototype, "apply").mockReturnValue(true),
      spyOn(TerminalRenderer.prototype, "isEnabled").mockReturnValue(true),
      spyOn(TerminalRenderer.prototype, "anchorFromCursor").mockResolvedValue(),
      spyOn(TerminalRenderer.prototype, "appendToolLine").mockImplementation(
        (line) => {
          lines.push(typeof line === "string" ? line : styledLineText(line));
        }
      ),
      spyOn(TerminalRenderer.prototype, "setStatusLine").mockImplementation(
        (line) => {
          status = line ? styledLineText(line) : "";
        }
      ),
      spyOn(TerminalInput.prototype, "start").mockImplementation(() => {}),
      spyOn(TerminalInput.prototype, "stop").mockImplementation(() => {}),
      spyOn(TerminalInput.prototype, "onInput").mockImplementation(
        (listener) => {
          ready.resolve(listener);
          return () => {};
        }
      ),
      spyOn(process.stdout, "write").mockReturnValue(true),
      spyOn(session, "sendStream").mockImplementation(
        async (_input, handlers) => {
          if (typeof handlers === "function") {
            throw new Error("Expected tool stream handlers");
          }
          handlers.onToolStart?.({
            input: { path: "src/chat.ts" },
            tool: "read_file",
            toolCallId: "a",
          });
          handlers.onToolInputDelta?.({
            delta: "raw arguments",
            tool: "read_file",
            toolCallId: "a",
          });
          states.push(status);
          handlers.onToolStart?.({
            input: { command: "bun test" },
            tool: "bash",
            toolCallId: "b",
          });
          handlers.onToolEnd?.({
            result: { content: "hidden output" },
            tool: "read_file",
            toolCallId: "a",
          });
          states.push(status);
          if (outcome !== "interrupted") {
            handlers.onToolEnd?.({
              result:
                outcome === "failure"
                  ? { error: "Test failed" }
                  : { content: "hidden output" },
              tool: "bash",
              toolCallId: "b",
            });
          }
          states.push(status);
          if (outcome === "thinking") {
            handlers.onThinking?.("Next step");
            completedBatches.push([...lines]);
            handlers.onThinking?.("Still thinking");
            completedBatches.push([...lines]);
            handlers.onToolStart?.({
              input: {},
              tool: "read_file",
              toolCallId: "c",
            });
            handlers.onToolEnd?.({
              result: { content: "hidden output" },
              tool: "read_file",
              toolCallId: "c",
            });
            handlers.onChunk?.("Done");
            completedBatches.push([...lines]);
          }
          finished.resolve();
          if (outcome === "interrupted") {
            throw new DOMException("Stopped", "AbortError");
          }
          return "Done";
        }
      ),
    ];
    const chat = runChat({
      channel: "cli",
      client,
      offline: true,
      signal: exit.signal,
    });
    try {
      const emit = await ready.promise;
      emit("hello");
      emit("\r");
      await finished.promise;
      await Bun.sleep(0);
      expect(states.slice(0, 2)).toEqual([
        "⠋ read_file src/chat.ts · 0 done",
        "⠋ bash bun test · 1 done",
      ]);
      expect(lines).toHaveLength(
        outcome === "failure" ? 3 : outcome === "thinking" ? 2 : 1
      );
      if (outcome === "thinking") {
        expect(completedBatches.map((batch) => batch.length)).toEqual([
          1, 1, 2,
        ]);
        expect(completedBatches[0]?.[0]).toStartWith("✓ 2 tools completed · ");
        expect(lines[1]).toStartWith("✓ 1 tool completed · ");
      }
      if (outcome === "failure") {
        expect(lines[0]).toStartWith("✗ bash bun test");
        expect(lines[1]).toContain("Test failed");
        expect(lines[2]).toStartWith("✗ 2 tools completed · 1 failed · ");
      } else {
        expect(lines[0]).toStartWith(
          outcome === "success" || outcome === "thinking"
            ? "✓ 2 tools completed · "
            : "✗ 1 tool completed · 1 interrupted · "
        );
      }
      expect(lines.join("\n")).not.toContain("hidden output");
      expect(lines.join("\n")).not.toContain("raw arguments");
    } finally {
      exit.abort();
      await chat;
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  }
);

test.each([
  {
    boundary: "none",
    delayedParsing: true,
    delayedPaste: false,
    withImages: true,
  },
  {
    boundary: "none",
    delayedParsing: false,
    delayedPaste: true,
    withImages: false,
  },
  {
    boundary: "endStream",
    delayedParsing: false,
    delayedPaste: false,
    withImages: false,
  },
  {
    boundary: "emptyQueue",
    delayedParsing: false,
    delayedPaste: false,
    withImages: false,
  },
])(
  "bounds pending input %j and resumes FIFO draining",
  async ({ boundary, delayedParsing, delayedPaste, withImages }) => {
    const selected: ProfileSummary = {
      createdAt: "",
      hasAvatar: false,
      id: "test",
      isSuper: false,
      mcpServerCount: 0,
      model: null,
      name: "Test",
      soulActive: false,
      toolCount: 0,
      updatedAt: "",
    };
    const client = new NakamaClient();
    const session = client.createChatSession("test", "cli");
    const ready = Promise.withResolvers<(chunk: string) => void>();
    const started = Promise.withResolvers<void>();
    const parsed = Promise.withResolvers<null>();
    const arrival = Promise.withResolvers<null>();
    const arrivalPreparing = Promise.withResolvers<void>();
    const arrivalSent = Promise.withResolvers<void>();
    const clipboardStarted = Promise.withResolvers<void>();
    const clipboardRelease = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const finalTurnEnded = Promise.withResolvers<void>();
    const finalStarted = Promise.withResolvers<void>();
    const finalRelease = Promise.withResolvers<void>();
    const exit = new AbortController();
    const sent: string[] = [];
    let aborted = false;
    let finalEnded = false;
    let pending: PendingMessage[] = [];
    const errors = spyOn(TerminalRenderer.prototype, "appendOutputLine");
    const getModels = spyOn(client, "getModels").mockRejectedValue(
      new Error("Offline")
    );
    const spies = [
      errors,
      getModels,
      spyOn(imageInput, "parseImageLine").mockImplementation((line) => {
        if (line === "boundary-arrival") {
          arrivalPreparing.resolve();
          // Return the held promise directly to control the admission microtask.
          return arrival.promise;
        }
        return delayedParsing ? parsed.promise : Promise.resolve(null);
      }),
      spyOn(clipboard, "readClipboardImage").mockImplementation(async () => {
        clipboardStarted.resolve();
        if (delayedPaste) {
          await clipboardRelease.promise;
        }
        return {
          data: Buffer.alloc(1024, pending.length).toString("base64"),
          mediaType: "image/png",
        };
      }),
      spyOn(profile, "resolveStartupProfile").mockResolvedValue({
        profile: selected,
        profileId: selected.id,
      }),
      spyOn(client, "listProfiles").mockResolvedValue({ profiles: [selected] }),
      spyOn(client, "createSession").mockResolvedValue(session),
      spyOn(session, "sendStream").mockImplementation(
        async (input, _handlers, options) => {
          sent.push(typeof input === "string" ? input : input.message);
          if (sent.at(-1) === "boundary-arrival") {
            arrivalSent.resolve();
          }
          if (sent.length === 1) {
            options?.signal?.addEventListener(
              "abort",
              () => release.resolve(),
              { once: true }
            );
            started.resolve();
            await release.promise;
            aborted = options?.signal?.aborted ?? false;
            throw new DOMException("Stopped", "AbortError");
          }
          if (sent.length === 21) {
            finalStarted.resolve();
            await finalRelease.promise;
          }
          if (boundary !== "none") {
            return "Reply";
          }
          throw new Error("Provider failed");
        }
      ),
      spyOn(TerminalRenderer.prototype, "apply").mockReturnValue(true),
      spyOn(TerminalRenderer.prototype, "endStream").mockImplementation(() => {
        if (sent.length === 21) {
          finalEnded = true;
          finalTurnEnded.resolve();
          if (boundary === "endStream") {
            arrival.resolve(null);
          }
        }
      }),
      spyOn(TerminalRenderer.prototype, "anchorFromCursor").mockResolvedValue(),
      spyOn(TerminalInput.prototype, "start").mockImplementation(() => {}),
      spyOn(TerminalInput.prototype, "stop").mockImplementation(() => {}),
      spyOn(TerminalInput.prototype, "onInput").mockImplementation(
        (listener) => {
          ready.resolve(listener);
          return () => {};
        }
      ),
      spyOn(
        TerminalRenderer.prototype,
        "setPendingMessages"
      ).mockImplementation((messages) => {
        pending = messages;
        if (boundary === "emptyQueue" && finalEnded && messages.length === 0) {
          arrival.resolve(null);
        }
      }),
      spyOn(process.stdout, "write").mockReturnValue(true),
    ];
    const chat = runChat({
      channel: "cli",
      client,
      offline: true,
      signal: exit.signal,
    });

    try {
      const emit = await ready.promise;
      if (delayedPaste) {
        emit("/paste");
        emit("\r");
        await clipboardStarted.promise;
      }
      emit("first");
      emit("\r");
      await Bun.sleep(0);
      if (!delayedParsing) {
        await started.promise;
      }
      for (let index = 0; index < 21; index += 1) {
        if (withImages) {
          emit("\u0016");
        }
        emit(`queued-${index}`);
        emit("\r");
        await Bun.sleep(0);
      }
      parsed.resolve(null);
      await started.promise;
      await Bun.sleep(0);

      expect(pending).toHaveLength(20);
      expect(sent).toEqual(["first"]);
      expect(errors).toHaveBeenCalledTimes(1);
      for (const message of pending) {
        expect(message.sendInput.images?.length ?? 0).toBe(withImages ? 1 : 0);
      }
      if (delayedPaste) {
        clipboardRelease.resolve();
        await Bun.sleep(0);
        expect(errors).toHaveBeenCalledTimes(2);
        expect(pending).toHaveLength(20);
      }
      emit("\u001b");
      await finalStarted.promise;
      expect(aborted).toBe(true);
      emit("/model");
      emit("\r");
      await Bun.sleep(0);
      expect(getModels).not.toHaveBeenCalled();
      if (boundary !== "none") {
        emit("boundary-arrival");
        emit("\r");
        await arrivalPreparing.promise;
      }
      finalRelease.resolve();
      if (boundary !== "none") {
        await arrivalSent.promise;
      }
      await finalTurnEnded.promise;
      await Bun.sleep(0);
      const admitted = [
        "first",
        ...Array.from({ length: 20 }, (_, index) => `queued-${index}`),
        ...(boundary === "none" ? [] : ["boundary-arrival"]),
      ];
      expect(sent).toEqual(admitted);
      emit("after-drain");
      emit("\r");
      await Bun.sleep(0);
      expect(sent).toEqual([...admitted, "after-drain"]);
      emit("/model");
      emit("\r");
      await Bun.sleep(0);
      expect(getModels).toHaveBeenCalledTimes(1);
    } finally {
      parsed.resolve(null);
      arrival.resolve(null);
      clipboardRelease.resolve();
      release.resolve();
      finalRelease.resolve();
      exit.abort();
      await chat;
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  }
);

test("switches models without updating the profile", async () => {
  const selected: ProfileSummary = {
    createdAt: "",
    hasAvatar: false,
    id: "test",
    isSuper: false,
    mcpServerCount: 0,
    model: "provider-a::old-model",
    name: "Test",
    soulActive: false,
    toolCount: 0,
    updatedAt: "",
  };
  const models: ModelsResponse = {
    currentProviderId: "provider-a",
    displayName: null,
    models: [
      {
        id: "new-model",
        name: "New model",
        provider: "openai",
        providerId: "provider-b",
      },
    ],
    provider: "openai",
    providers: [],
  };
  const client = new NakamaClient();
  const initialSession = client.createChatSession("initial", "cli");
  const switchedSession = client.createChatSession("switched", "cli");
  const ready = Promise.withResolvers<(chunk: string) => void>();
  const modelsRequested = Promise.withResolvers<void>();
  const exit = new AbortController();
  const createSession = spyOn(client, "createSession")
    .mockResolvedValueOnce(initialSession)
    .mockResolvedValueOnce(switchedSession);
  const updateProfile = spyOn(client, "updateProfile").mockRejectedValue(
    new Error("Forbidden")
  );
  const spies = [
    createSession,
    updateProfile,
    spyOn(client, "getModels").mockImplementation(async () => {
      modelsRequested.resolve();
      return models;
    }),
    spyOn(profile, "resolveStartupProfile").mockResolvedValue({
      profile: selected,
      profileId: selected.id,
    }),
    spyOn(TerminalRenderer.prototype, "apply").mockReturnValue(true),
    spyOn(TerminalRenderer.prototype, "anchorFromCursor").mockResolvedValue(),
    spyOn(TerminalInput.prototype, "start").mockImplementation(() => {}),
    spyOn(TerminalInput.prototype, "stop").mockImplementation(() => {}),
    spyOn(TerminalInput.prototype, "onInput").mockImplementation((listener) => {
      ready.resolve(listener);
      return () => {};
    }),
    spyOn(process.stdout, "write").mockReturnValue(true),
  ];
  const chat = runChat({
    channel: "cli",
    client,
    offline: true,
    signal: exit.signal,
  });

  try {
    const emit = await ready.promise;
    emit("/model provider-b::new-model");
    emit("\r");
    await modelsRequested.promise;
    await Bun.sleep(0);

    expect(updateProfile).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenLastCalledWith("cli", {
      codingWorkspaceRoot: undefined,
      model: "provider-b::new-model",
      profileId: "test",
    });
  } finally {
    exit.abort();
    await chat;
    for (const spy of spies) {
      spy.mockRestore();
    }
  }
});
