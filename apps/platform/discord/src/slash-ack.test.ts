import { describe, expect, test } from "bun:test";
import { deferSlashInteraction } from "./slash-ack";

describe("deferSlashInteraction", () => {
  test("returns true when deferReply succeeds", async () => {
    const interaction = {
      commandName: "help",
      deferReply: async () => {},
      editReply: async () => {
        throw new Error("editReply should not run");
      },
      reply: async () => {
        throw new Error("reply should not run");
      },
    };

    await expect(deferSlashInteraction(interaction)).resolves.toBe(true);
  });

  test("skips without user reply for ignorable interaction errors", async () => {
    const calls: string[] = [];
    const interaction = {
      commandName: "help",
      deferReply: async () => {
        throw Object.assign(new Error("unknown interaction"), { code: 10_062 });
      },
      editReply: async () => {
        calls.push("editReply");
      },
      reply: async () => {
        calls.push("reply");
      },
    };

    await expect(deferSlashInteraction(interaction)).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  test("replies once when deferReply fails with a non-ignorable error", async () => {
    const calls: string[] = [];
    const interaction = {
      commandName: "help",
      deferReply: async () => {
        throw new Error("network");
      },
      editReply: async ({ content }: { content: string }) => {
        calls.push(`editReply:${content}`);
      },
      reply: async ({ content }: { content: string }) => {
        calls.push(`reply:${content}`);
      },
    };

    await expect(deferSlashInteraction(interaction)).resolves.toBe(false);
    expect(calls).toEqual(["reply:Something went wrong."]);
  });

  test("falls back to editReply when reply also fails after defer error", async () => {
    const calls: string[] = [];
    const interaction = {
      commandName: "org",
      deferReply: async () => {
        throw new Error("network");
      },
      editReply: async ({ content }: { content: string }) => {
        calls.push(`editReply:${content}`);
      },
      reply: async () => {
        throw new Error("already acked");
      },
    };

    await expect(deferSlashInteraction(interaction)).resolves.toBe(false);
    expect(calls).toEqual(["editReply:Something went wrong."]);
  });
});
