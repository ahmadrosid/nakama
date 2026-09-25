import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NakamaApiError } from "./api-error";
import { validateAutomationDelivery } from "./automation-delivery";
import {
  canApproveAutomationDeliveryDestination,
  isTelegramDeliveryChatAuthorized,
} from "./automation-delivery-destination";
import { getDiscordConfigDir, getDiscordConfigPath } from "./discord-config";
import { getTelegramConfigDir, getTelegramConfigPath } from "./telegram-config";

const owner = { orgId: "org_a", profileId: "agent_a" };
const member = { ...owner, access: { orgRole: "member" as const } };
const orgAdmin = { ...owner, access: { orgRole: "admin" as const } };

const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;

/** Every request the destination check made, so tests can assert no lookup happened. */
function recordingFetch(handler: (url: string) => Response): {
  calls: string[];
  fetchImpl: typeof fetch;
} {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    return handler(url);
  }) as unknown as typeof fetch;

  return { calls, fetchImpl };
}

async function writeTelegramConfig(contents: string): Promise<string> {
  const configDir = await mkdtemp(join(tmpdir(), "nakama-telegram-dest-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  await mkdir(getTelegramConfigDir(owner), { recursive: true });
  await writeFile(getTelegramConfigPath(owner), contents, "utf8");
  return configDir;
}

async function writeDiscordConfig(contents: string): Promise<string> {
  const configDir = await mkdtemp(join(tmpdir(), "nakama-discord-dest-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  await mkdir(getDiscordConfigDir(owner), { recursive: true });
  await writeFile(getDiscordConfigPath(owner), contents, "utf8");
  return configDir;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

async function captureRejection(
  run: () => Promise<unknown>
): Promise<NakamaApiError> {
  const error = await run().then(
    () => null,
    (thrown: unknown) => thrown
  );

  expect(error).toBeInstanceOf(NakamaApiError);
  return error as NakamaApiError;
}

describe("cross-destination authorization for automation delivery", () => {
  afterEach(async () => {
    if (previousConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
    }
  });

  test("a member cannot pin telegram delivery to an unpaired chat", async () => {
    const configDir = await writeTelegramConfig(
      "bot_token=test-token\npaired_user_ids=111\n"
    );
    const { calls, fetchImpl } = recordingFetch(() =>
      jsonResponse({ ok: true, result: {} })
    );

    const error = await captureRejection(() =>
      validateAutomationDelivery(
        { channel: "telegram", chatId: 999 },
        { ...member, fetchImpl }
      )
    );

    expect(error.status).toBe(403);
    expect(error.message).toContain("organization admin");
    // The member is refused before the provider is ever consulted.
    expect(calls).toEqual([]);

    await rm(configDir, { force: true, recursive: true });
  });

  test("a member can pin telegram delivery to a paired or allowlisted chat", async () => {
    const configDir = await writeTelegramConfig(
      "bot_token=test-token\npaired_user_ids=111\nallowed_user_ids=222\n"
    );
    const { calls, fetchImpl } = recordingFetch(() =>
      jsonResponse({ ok: true, result: {} })
    );

    for (const chatId of [111, 222]) {
      await expect(
        validateAutomationDelivery(
          { channel: "telegram", chatId },
          { ...member, fetchImpl }
        )
      ).resolves.toBeUndefined();
    }

    expect(calls).toEqual([]);

    await rm(configDir, { force: true, recursive: true });
  });

  test("a member cannot pin discord delivery to a channel", async () => {
    const configDir = await writeDiscordConfig(
      "bot_token=test-token\npaired_user_ids=123456789012345678\n"
    );
    const { calls, fetchImpl } = recordingFetch(() =>
      jsonResponse({ id: "999" })
    );

    const error = await captureRejection(() =>
      validateAutomationDelivery(
        { channel: "discord", channelId: "123456789012345679" },
        { ...member, fetchImpl }
      )
    );

    expect(error.status).toBe(403);
    expect(calls).toEqual([]);

    await rm(configDir, { force: true, recursive: true });
  });

  test("an admin telegram override is verified against the provider", async () => {
    const configDir = await writeTelegramConfig(
      "bot_token=test-token\npaired_user_ids=111\n"
    );
    const { calls, fetchImpl } = recordingFetch(() =>
      jsonResponse({
        ok: true,
        result: { id: 999, permissions: { can_send_messages: true } },
      })
    );

    await expect(
      validateAutomationDelivery(
        { channel: "telegram", chatId: 999 },
        { ...orgAdmin, fetchImpl }
      )
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      "https://api.telegram.org/bottest-token/getChat?chat_id=999",
    ]);

    await rm(configDir, { force: true, recursive: true });
  });

  test("an admin telegram override is refused when the bot cannot post", async () => {
    const configDir = await writeTelegramConfig(
      "bot_token=test-token\npaired_user_ids=111\n"
    );
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        ok: true,
        result: { id: 999, permissions: { can_send_messages: false } },
      })
    );

    const error = await captureRejection(() =>
      validateAutomationDelivery(
        { channel: "telegram", chatId: 999 },
        { ...orgAdmin, fetchImpl }
      )
    );

    expect(error.status).toBe(400);
    expect(error.message).toContain("cannot post in chat 999");

    await rm(configDir, { force: true, recursive: true });
  });

  test("an admin telegram override is refused for an unreachable chat", async () => {
    const configDir = await writeTelegramConfig(
      "bot_token=test-token\npaired_user_ids=111\n"
    );
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ description: "Bad Request" }, 400)
    );

    const error = await captureRejection(() =>
      validateAutomationDelivery(
        { channel: "telegram", chatId: 999 },
        { ...orgAdmin, fetchImpl }
      )
    );

    expect(error.status).toBe(400);
    expect(error.message).toContain("not reachable");

    await rm(configDir, { force: true, recursive: true });
  });

  test("an admin discord override needs view and send permission", async () => {
    const configDir = await writeDiscordConfig("bot_token=test-token\n");
    const sendOnly = recordingFetch((url) =>
      url.endsWith("/users/@me")
        ? jsonResponse({ id: "555" })
        : jsonResponse({ permissions: "2048" })
    );

    const missingView = await captureRejection(() =>
      validateAutomationDelivery(
        { channel: "discord", channelId: "123456789012345679" },
        { ...orgAdmin, fetchImpl: sendOnly.fetchImpl }
      )
    );

    expect(missingView.status).toBe(400);
    expect(missingView.message).toContain("cannot post in channel");

    const viewAndSend = recordingFetch((url) =>
      url.endsWith("/users/@me")
        ? jsonResponse({ id: "555" })
        : jsonResponse({ permissions: "3072" })
    );

    await expect(
      validateAutomationDelivery(
        { channel: "discord", channelId: "123456789012345679" },
        { ...orgAdmin, fetchImpl: viewAndSend.fetchImpl }
      )
    ).resolves.toBeUndefined();
    expect(viewAndSend.calls).toEqual([
      "https://discord.com/api/v10/users/@me",
      "https://discord.com/api/v10/channels/123456789012345679/permissions/555",
    ]);

    await rm(configDir, { force: true, recursive: true });
  });

  test("an admin discord override is refused when the channel is unreachable", async () => {
    const configDir = await writeDiscordConfig("bot_token=test-token\n");
    const { fetchImpl } = recordingFetch((url) =>
      url.endsWith("/users/@me")
        ? jsonResponse({ id: "555" })
        : new Response("Missing Access", { status: 403 })
    );

    const error = await captureRejection(() =>
      validateAutomationDelivery(
        { channel: "discord", channelId: "123456789012345679" },
        { ...orgAdmin, fetchImpl }
      )
    );

    expect(error.status).toBe(400);
    expect(error.message).toContain("not reachable");

    await rm(configDir, { force: true, recursive: true });
  });

  test("a member keeps an admin-approved destination while editing other fields", async () => {
    const configDir = await writeDiscordConfig(
      "bot_token=test-token\npaired_user_ids=123456789012345678\n"
    );
    const { calls, fetchImpl } = recordingFetch(() =>
      jsonResponse({ id: "555" })
    );

    await expect(
      validateAutomationDelivery(
        { channel: "discord", channelId: "123456789012345679" },
        {
          ...member,
          fetchImpl,
          previousDelivery: {
            channel: "discord",
            channelId: "123456789012345679",
          },
        }
      )
    ).resolves.toBeUndefined();
    expect(calls).toEqual([]);

    await rm(configDir, { force: true, recursive: true });
  });

  test("a member is re-locked when they retarget an approved destination", async () => {
    const configDir = await writeDiscordConfig(
      "bot_token=test-token\npaired_user_ids=123456789012345678\n"
    );
    const { fetchImpl } = recordingFetch(() => jsonResponse({ id: "555" }));

    const error = await captureRejection(() =>
      validateAutomationDelivery(
        { channel: "discord", channelId: "987654321098765432" },
        {
          ...member,
          fetchImpl,
          previousDelivery: {
            channel: "discord",
            channelId: "123456789012345679",
          },
        }
      )
    );

    expect(error.status).toBe(403);

    await rm(configDir, { force: true, recursive: true });
  });

  test("only admins may approve a destination", () => {
    expect(canApproveAutomationDeliveryDestination(undefined)).toBe(false);
    expect(canApproveAutomationDeliveryDestination({ orgRole: "viewer" })).toBe(
      false
    );
    expect(canApproveAutomationDeliveryDestination({ orgRole: "admin" })).toBe(
      true
    );
    expect(
      canApproveAutomationDeliveryDestination({ isPlatformAdmin: true })
    ).toBe(true);
  });

  test("telegram chat authorization follows paired and allowlisted ids only", () => {
    const config = { allowedUserIds: [222], pairedUserIds: [111] };

    expect(isTelegramDeliveryChatAuthorized(111, config)).toBe(true);
    expect(isTelegramDeliveryChatAuthorized(222, config)).toBe(true);
    expect(isTelegramDeliveryChatAuthorized(999, config)).toBe(false);
  });
});
