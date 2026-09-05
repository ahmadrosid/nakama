import { expect, spyOn, test } from "bun:test";
import { NakamaClient } from "@nakama/client";
import type { ProfileSummary } from "@nakama/core";
import { runChat } from "./chat";
import * as clipboard from "./clipboard-image";
import * as imageInput from "./image-input";
import type { PendingMessage } from "./message-queue";
import * as profile from "./profile";
import { TerminalInput } from "./terminal-input";
import { TerminalRenderer } from "./terminal-renderer";

test.each([
  {
    boundary: "none",
    delayedParsing: false,
    delayedPaste: false,
    withImages: false,
  },
  {
    boundary: "none",
    delayedParsing: false,
    delayedPaste: false,
    withImages: true,
  },
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
      emit("/models");
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
      emit("/models");
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
