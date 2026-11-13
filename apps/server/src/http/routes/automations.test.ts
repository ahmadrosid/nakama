import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type GetAutomationRunResponse,
  getDiscordConfigDir,
  getDiscordConfigPath,
  getTelegramConfigDir,
  getTelegramConfigPath,
  type ListAutomationRunsResponse,
  type RunAutomationResponse,
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
    expect((await call("/runs/run_any", "GET")).status).toBe(403);
    expect((await call("/run", "POST")).status).toBe(403);
    expect((await call("/webhook-secret", "POST")).status).toBe(403);
    expect(
      (await call("", "PUT", JSON.stringify({ enabled: false }))).status
    ).toBe(403);
  });
});

describe("automation run history over HTTP", () => {
  test("the list leaves out finished transcripts and the run route returns one compressed", async () => {
    const fixture = createFixture();
    const { orgId, session } = await loginMember(fixture);
    const service = fixture.automationService;

    const automation = await service.create(
      orgId,
      {
        description: "Report",
        name: "Report",
        prompt: "Summarize the week",
        trigger: { type: "manual" },
      },
      PROFILE_ID
    );

    const longPrompt = "Summarize the week. ".repeat(500);
    const finished = await service.createRun(automation.id);
    service.setRunProgress(finished.id, {
      output: "Writing",
      progress: [
        { content: longPrompt, role: "user" },
        { content: "Writing", role: "assistant" },
      ],
    });
    await service.completeRun(finished.id, automation.id, { output: "Done" });

    const live = await service.createRun(automation.id);
    service.setRunProgress(live.id, {
      output: "Working",
      progress: [{ content: "Working", role: "assistant" }],
    });

    const get = (path: string, headers: Record<string, string> = {}) =>
      fixture.app.fetch(
        new Request(`http://localhost:4310/v1/automations/${path}`, {
          headers: { ...session.headers(), ...headers },
        })
      );

    const list = await get(`${automation.id}/runs`);
    expect(list.status).toBe(200);
    // SAFETY: The 200 above means the route returned its list response.
    const { runs } = (await list.json()) as ListAutomationRunsResponse;
    const listed = runs.find((run) => run.id === finished.id);
    expect(listed).toMatchObject({ output: "Done", status: "completed" });
    expect(listed).not.toHaveProperty("progress");
    expect(runs.find((run) => run.id === live.id)?.progress).toEqual([
      { content: "Working", role: "assistant" },
    ]);

    const one = await get(`${automation.id}/runs/${finished.id}`, {
      "Accept-Encoding": "gzip",
    });

    expect(one.status).toBe(200);
    expect(one.headers.get("Content-Encoding")).toBe("gzip");

    // SAFETY: The 200 above means the route returned its run response.
    const { run } = JSON.parse(
      new TextDecoder().decode(Bun.gunzipSync(await one.bytes()))
    ) as GetAutomationRunResponse;

    expect(run.progress).toEqual([
      { content: longPrompt, role: "user" },
      { content: "Done", role: "assistant" },
    ]);
    expect((await get(`${automation.id}/runs/run_missing`)).status).toBe(404);

    // Another org's automation is not found, even with a real run id
    const now = new Date().toISOString();
    await fixture.databaseAdapter.upsertOrganization({
      createdAt: now,
      id: "org_other",
      name: "Other",
      slug: "other",
      updatedAt: now,
    });
    await fixture.databaseAdapter.upsertProfile({
      createdAt: now,
      id: "profile_other",
      isDefault: true,
      isSuper: false,
      model: null,
      name: "Other Bot",
      orgId: "org_other",
      systemPrompt: "",
      updatedAt: now,
    });

    const foreign = await service.create(
      "org_other",
      {
        description: "Report",
        name: "Report",
        prompt: "Summarize the week",
        trigger: { type: "manual" },
      },
      "profile_other"
    );

    const foreignRun = await service.createRun(foreign.id);
    expect((await get(`${foreign.id}/runs/${foreignRun.id}`)).status).toBe(404);
  });

  test("running an automation now returns the finished run with its transcript", async () => {
    const progress = [
      { content: "Summarize the week", role: "user" as const },
      { content: "Done", role: "assistant" as const },
    ];

    const fixture = createFixture({
      agent: (service) => ({
        providerConfigured: true,
        runAutomation: async (automationId: string) => {
          const run = await service.createRun(automationId);
          service.setRunProgress(run.id, { output: "Done", progress });
          await service.completeRun(run.id, automationId, { output: "Done" });

          return { output: "Done" };
        },
      }),
    });

    const { orgId, session } = await loginMember(fixture);

    const automation = await fixture.automationService.create(
      orgId,
      {
        description: "Report",
        name: "Report",
        prompt: "Summarize the week",
        trigger: { type: "manual" },
      },
      PROFILE_ID
    );

    const response = await fixture.app.fetch(
      new Request(`http://localhost:4310/v1/automations/${automation.id}/run`, {
        headers: { "X-CSRF-Token": session.csrfToken, ...session.headers() },
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    // SAFETY: The 200 above means the route returned its run response.
    const { run } = (await response.json()) as RunAutomationResponse;
    expect(run).toMatchObject({
      output: "Done",
      progress,
      status: "completed",
    });
  });
});
