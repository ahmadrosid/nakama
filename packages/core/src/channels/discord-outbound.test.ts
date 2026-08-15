import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDiscordConfigDir, getDiscordConfigPath } from "../discord-config";
import { createDiscordOutboundAdapter } from "./discord-outbound";

describe("createDiscordOutboundAdapter", () => {
  const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;

  afterEach(async () => {
    if (previousConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
    }
  });

  async function withDiscordConfig(
    ini: string,
    run: () => Promise<void>
  ): Promise<void> {
    const configDir = await mkdtemp(join(tmpdir(), "nakama-discord-outbound-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    await mkdir(getDiscordConfigDir(), { recursive: true });
    await writeFile(getDiscordConfigPath(), ini, "utf8");

    try {
      await run();
    } finally {
      await rm(configDir, { force: true, recursive: true });
    }
  }

  test("posts to a guild channel with bot auth and mention suppression", async () => {
    await withDiscordConfig("bot_token=test-bot-token\n", async () => {
      const calls: Array<{
        body: Record<string, unknown>;
        headers: Record<string, string>;
        url: string;
      }> = [];
      const adapter = createDiscordOutboundAdapter({
        fetchImpl: async (input, init) => {
          calls.push({
            body: JSON.parse(String(init?.body)),
            headers: Object.fromEntries(new Headers(init?.headers).entries()),
            url: String(input),
          });
          return new Response("{}", { status: 200 });
        },
      });

      await expect(
        adapter.send({
          channelId: "123456789012345678",
          text: "hello",
        })
      ).resolves.toEqual({ ok: true });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(
        "https://discord.com/api/v10/channels/123456789012345678/messages"
      );
      expect(calls[0]?.headers.authorization).toBe("Bot test-bot-token");
      expect(calls[0]?.headers["user-agent"]).toStartWith("DiscordBot");
      expect(calls[0]?.body).toEqual({
        allowed_mentions: { parse: [] },
        content: "hello",
      });
    });
  });

  test("opens a DM per paired user then posts to the returned channel", async () => {
    await withDiscordConfig(
      "bot_token=test-bot-token\npaired_user_ids=111111111111111111,222222222222222222\n",
      async () => {
        const calls: Array<{ body: Record<string, unknown>; url: string }> = [];
        const adapter = createDiscordOutboundAdapter({
          fetchImpl: async (input, init) => {
            const url = String(input);
            const body = JSON.parse(String(init?.body)) as Record<
              string,
              unknown
            >;
            calls.push({ body, url });

            if (url.endsWith("/users/@me/channels")) {
              const recipient = String(body.recipient_id);
              return Response.json({
                id: `dm-${recipient}`,
              });
            }

            return new Response("{}", { status: 200 });
          },
        });

        await expect(adapter.send({ text: "hello" })).resolves.toEqual({
          ok: true,
        });

        expect(calls.map((call) => call.url)).toEqual([
          "https://discord.com/api/v10/users/@me/channels",
          "https://discord.com/api/v10/channels/dm-111111111111111111/messages",
          "https://discord.com/api/v10/users/@me/channels",
          "https://discord.com/api/v10/channels/dm-222222222222222222/messages",
        ]);
        expect(calls[0]?.body).toEqual({ recipient_id: "111111111111111111" });
        expect(calls[2]?.body).toEqual({ recipient_id: "222222222222222222" });
      }
    );
  });

  test("chunks text longer than 2000 into multiple posts", async () => {
    await withDiscordConfig("bot_token=test-bot-token\n", async () => {
      const contents: string[] = [];
      const adapter = createDiscordOutboundAdapter({
        fetchImpl: async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as { content: string };
          contents.push(body.content);
          return new Response("{}", { status: 200 });
        },
      });

      await expect(
        adapter.send({
          channelId: "123456789012345678",
          text: "a".repeat(2500),
        })
      ).resolves.toEqual({ ok: true });

      expect(contents.length).toBeGreaterThan(1);
      expect(contents.every((chunk) => chunk.length <= 2000)).toBe(true);
    });
  });

  test("returns without fetch when the bot token is missing", async () => {
    await withDiscordConfig("", async () => {
      let called = false;
      const adapter = createDiscordOutboundAdapter({
        fetchImpl: async () => {
          called = true;
          return new Response("{}", { status: 200 });
        },
      });

      await expect(adapter.send({ text: "hello" })).resolves.toEqual({
        error: "Discord bot token is not configured.",
        ok: false,
      });
      expect(called).toBe(false);
    });
  });

  test("returns without fetch when no paired users and no channelId", async () => {
    await withDiscordConfig("bot_token=test-bot-token\n", async () => {
      let called = false;
      const adapter = createDiscordOutboundAdapter({
        fetchImpl: async () => {
          called = true;
          return new Response("{}", { status: 200 });
        },
      });

      await expect(adapter.send({ text: "hello" })).resolves.toEqual({
        error: "No Discord user is paired.",
        ok: false,
      });
      expect(called).toBe(false);
    });
  });

  test("stops the loop on the first 403 or 429", async () => {
    await withDiscordConfig(
      "bot_token=test-bot-token\npaired_user_ids=111111111111111111,222222222222222222\n",
      async () => {
        const urls: string[] = [];
        const adapter = createDiscordOutboundAdapter({
          fetchImpl: async (input) => {
            urls.push(String(input));

            if (String(input).endsWith("/users/@me/channels")) {
              return Response.json({ id: "dm-1" });
            }

            return new Response("missing access", { status: 403 });
          },
        });

        const result = await adapter.send({ text: "hello" });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("403");
        expect(urls.filter((url) => url.includes("/messages"))).toHaveLength(1);
        expect(
          urls.filter((url) => url.includes("/users/@me/channels"))
        ).toHaveLength(1);
      }
    );
  });

  test("rejects empty text", async () => {
    await withDiscordConfig(
      "bot_token=test-bot-token\npaired_user_ids=111111111111111111\n",
      async () => {
        const adapter = createDiscordOutboundAdapter({
          fetchImpl: async () => new Response("{}", { status: 200 }),
        });

        await expect(adapter.send({ text: "   " })).resolves.toEqual({
          error: "Message text is empty.",
          ok: false,
        });
      }
    );
  });
});
