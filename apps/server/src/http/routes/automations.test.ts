import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getDiscordConfigDir,
  getDiscordConfigPath,
  getTelegramConfigDir,
  getTelegramConfigPath,
} from "@nakama/core";
import { setupTestConfigDir } from "../../test-config-dir";
import {
  createFixture,
  loginMember,
  PROFILE_ID,
} from "./automation-route-test-fixtures";

setupTestConfigDir("nakama-automation-routes-");

async function writeChannelConfigs(orgId: string): Promise<string> {
  const configDir = await mkdtemp(join(tmpdir(), "nakama-automation-route-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  const owner = { orgId, profileId: PROFILE_ID };

  await mkdir(getTelegramConfigDir(owner), { recursive: true });
  await writeFile(
    getTelegramConfigPath(owner),
    "bot_token=test-token\npaired_user_ids=111\n",
    "utf8"
  );
  await mkdir(getDiscordConfigDir(owner), { recursive: true });
  await writeFile(
    getDiscordConfigPath(owner),
    "bot_token=test-token\npaired_user_ids=123456789012345678\n",
    "utf8"
  );

  return configDir;
}

function automationBody<T>(delivery: T): string {
  return JSON.stringify({
    delivery,
    description: "Report",
    name: "Report",
    profileId: PROFILE_ID,
    prompt: "Summarize the week",
    trigger: { type: "manual" },
  });
}

describe("automation destination authorization over HTTP", () => {
  test("a member cannot create an automation aimed at a foreign destination", async () => {
    const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
    const fixture = createFixture();
    const { orgId, session } = await loginMember(fixture);
    const app = fixture.app;
    const configDir = await writeChannelConfigs(orgId);

    try {
      for (const delivery of [
        { channel: "telegram", chatId: 999 },
        { channel: "discord", channelId: "123456789012345679" },
      ]) {
        const response = await app.fetch(
          new Request("http://localhost:4310/v1/automations", {
            body: automationBody(delivery),
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
              ...session.headers(),
            },
            method: "POST",
          })
        );

        expect(response.status).toBe(403);
        // SAFETY: This test controls the fixture shape at this boundary.
        expect(((await response.json()) as { error: string }).error).toContain(
          "organization admin"
        );
      }

      const paired = await app.fetch(
        new Request("http://localhost:4310/v1/automations", {
          body: automationBody({ channel: "telegram", chatId: 111 }),
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            ...session.headers(),
          },
          method: "POST",
        })
      );

      expect(paired.status).toBe(201);
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
      }

      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("a member cannot repoint an existing automation at a new destination", async () => {
    const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
    const fixture = createFixture();
    const { orgId, session } = await loginMember(fixture);
    const app = fixture.app;
    const configDir = await writeChannelConfigs(orgId);

    try {
      const created = await fixture.automationService.create(
        orgId,
        {
          delivery: { channel: "telegram", chatId: 111 },
          description: "Report",
          name: "Report",
          prompt: "Summarize the week",
          trigger: { type: "manual" },
        },
        PROFILE_ID,
        { isPlatformAdmin: false, orgRole: "admin" }
      );

      const response = await app.fetch(
        new Request(`http://localhost:4310/v1/automations/${created.id}`, {
          body: JSON.stringify({
            delivery: { channel: "telegram", chatId: 999 },
          }),
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            ...session.headers(),
          },
          method: "PUT",
        })
      );

      expect(response.status).toBe(403);
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
      }

      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("a member cannot run, read or change an automation on a mailbox agent", async () => {
    const fixture = createFixture();
    const { orgId, session } = await loginMember(fixture);
    const now = new Date().toISOString();

    await fixture.databaseAdapter.upsertTool({
      createdAt: now,
      description: "Mailbox",
      handlerConfig: {},
      handlerType: "builtin",
      id: "tool_email",
      name: "email",
      updatedAt: now,
    });
    await fixture.databaseAdapter.assignToolToProfile(PROFILE_ID, "tool_email");

    const created = await fixture.automationService.create(
      orgId,
      {
        description: "Inbox digest",
        name: "Inbox",
        prompt: "Summarize the inbox",
        trigger: { type: "manual" },
      },
      PROFILE_ID,
      { isPlatformAdmin: false, orgRole: "admin" }
    );

    const call = (path: string, method: string, body?: string) =>
      fixture.app.fetch(
        new Request(
          `http://localhost:4310/v1/automations/${created.id}${path}`,
          {
            body,
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
              ...session.headers(),
            },
            method,
          }
        )
      );

    expect((await call("/runs", "GET")).status).toBe(403);
    expect((await call("/run", "POST")).status).toBe(403);
    expect((await call("/webhook-secret", "POST")).status).toBe(403);
    expect(
      (await call("", "PUT", JSON.stringify({ enabled: false }))).status
    ).toBe(403);
  });
});
