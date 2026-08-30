import { describe, expect, test } from "bun:test";
import {
  deferSlashInteraction,
  getDiscordErrorCode,
  isIgnorableInteractionError,
} from "./interaction-errors";

describe("isIgnorableInteractionError", () => {
  test("treats Unknown interaction (10062) as ignorable", () => {
    expect(isIgnorableInteractionError({ code: 10_062 })).toBe(true);
  });

  test("treats already acknowledged (40060) as ignorable", () => {
    expect(isIgnorableInteractionError({ code: 40_060 })).toBe(true);
  });

  test("does not ignore unrelated errors", () => {
    expect(isIgnorableInteractionError({ code: 50_035 })).toBe(false);
    expect(isIgnorableInteractionError(new Error("boom"))).toBe(false);
    expect(isIgnorableInteractionError(null)).toBe(false);
  });
});

describe("getDiscordErrorCode", () => {
  test("reads numeric code", () => {
    expect(getDiscordErrorCode({ code: 10_062 })).toBe(10_062);
  });

  test("returns null without a numeric code", () => {
    expect(getDiscordErrorCode({ code: "10062" })).toBeNull();
    expect(getDiscordErrorCode("nope")).toBeNull();
  });
});

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
