import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AutomationResponse,
  type GetAutomationRunResponse,
  getDiscordConfigDir,
  getDiscordConfigPath,
  getTelegramConfigDir,
  getTelegramConfigPath,
  type ListAutomationRunsResponse,
  type RunAutomationResponse,
  type UpdateAutomationRequest,
} from "@nakama/core";
import { DatabaseAutomationStore } from "@nakama/db";
import { setupTestConfigDir } from "../../test-config-dir";
import {
  createFixture,
  loginMember,
  PROFILE_ID,
} from "./automation-route-test-fixtures";

setupTestConfigDir("nakama-automation-routes-");

async function createUpdateFixture() {
  const fixture = createFixture();
  const { orgId, session } = await loginMember(fixture);

  const automation = await fixture.automationService.create(
    orgId,
    {
      description: "Daily report",
      name: "Daily report",
      prompt: "Summarize yesterday",
      trigger: { type: "manual" },
    },
    PROFILE_ID
  );

  const update = (body: UpdateAutomationRequest) =>
    fixture.app.fetch(
      new Request(`http://localhost:4310/v1/automations/${automation.id}`, {
        body: JSON.stringify(body),
        headers: {
          ...session.headers(),
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
        method: "PUT",
      })
    );

  return { automation, fixture, orgId, session, update };
}

describe("concurrent partial automation updates", () => {
  test("service updates preserve both fields and advance each version", async () => {
    const { automation, fixture, orgId } = await createUpdateFixture();
    const service = fixture.automationService;
    const access = { orgRole: "member" as const, userId: "user_route_member" };

    const responses = await Promise.all([
      service.update(
        automation.id,
        orgId,
        { prompt: "Summarize today" },
        access
      ),
      service.update(automation.id, orgId, { enabled: false }, access),
    ]);

    expect(await service.get(automation.id, orgId)).toMatchObject({
      enabled: false,
      prompt: "Summarize today",
      version: 3,
    });
    expect(responses.map(({ version }) => version)).toEqual([2, 3]);
    expect(
      await fixture.databaseAdapter.getAutomation(automation.id)
    ).toMatchObject({
      definition: { prompt: "Summarize today", version: 3 },
      enabled: false,
      version: 3,
    });
  });

  for (const promptFirst of [true, false]) {
    test(`HTTP updates preserve both fields with ${promptFirst ? "prompt" : "pause"} first`, async () => {
      const { automation, fixture, orgId, update } =
        await createUpdateFixture();

      const firstRead = Promise.withResolvers<void>();
      const releaseRead = Promise.withResolvers<void>();
      const secondEntered = Promise.withResolvers<void>();
      const db = fixture.databaseAdapter;
      const service = fixture.automationService;
      const originalRead = db.getAutomation.bind(db);
      const originalUpdate = service.update.bind(service);
      let reads = 0;
      let updates = 0;

      db.getAutomation = async (id) => {
        const row = await originalRead(id);

        if (id === automation.id && ++reads === 1) {
          firstRead.resolve();
          await releaseRead.promise;
        }

        return row;
      };

      service.update = (...args) => {
        const pending = originalUpdate(...args);

        if (++updates === 2) {
          secondEntered.resolve();
        }

        return pending;
      };

      let responses: Response[];

      try {
        const first = update(
          promptFirst ? { prompt: "Summarize today" } : { enabled: false }
        );

        await firstRead.promise;

        const second = update(
          promptFirst ? { enabled: false } : { prompt: "Summarize today" }
        );

        await secondEntered.promise;
        releaseRead.resolve();
        responses = await Promise.all([first, second]);
      } finally {
        releaseRead.resolve();
        db.getAutomation = originalRead;
        service.update = originalUpdate;
      }

      expect(responses.map(({ status }) => status)).toEqual([200, 200]);

      // SAFETY: Both responses are HTTP 200 from the registered automation route.
      const bodies = await Promise.all(
        responses.map(
          async (response) => (await response.json()) as AutomationResponse
        )
      );

      expect(await service.get(automation.id, orgId)).toMatchObject({
        enabled: false,
        prompt: "Summarize today",
        version: 3,
      });
      expect(bodies.map(({ automation: saved }) => saved.version)).toEqual([
        2, 3,
      ]);
    });
  }

  test("a rejected update leaves the version unchanged and permits the next update", async () => {
    const { automation, fixture, orgId, update } = await createUpdateFixture();

    const responses = await Promise.all([
      update({ profileId: "missing_profile" }),
      update({ prompt: "Summarize today" }),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([400, 200]);
    expect(
      await fixture.automationService.get(automation.id, orgId)
    ).toMatchObject({
      enabled: true,
      profileId: PROFILE_ID,
      prompt: "Summarize today",
      version: 2,
    });
  });
});

describe("automation deletion", () => {
  for (const versioned of [false, true]) {
    test(`an overlapping update cannot restore a deleted row, versioned=${versioned}`, async () => {
      const { automation, fixture, orgId, session, update } =
        await createUpdateFixture();

      const service = fixture.automationService;
      const db = fixture.databaseAdapter;
      const firstRead = Promise.withResolvers<void>();
      const releaseRead = Promise.withResolvers<void>();
      const deleteEntered = Promise.withResolvers<void>();
      const originalRead = db.getAutomation.bind(db);
      const originalDelete = service.delete.bind(service);
      let reads = 0;
      let changes = 0;

      service.setOnChange(() => {
        changes += 1;
      });

      db.getAutomation = async (id) => {
        const row = await originalRead(id);

        if (id === automation.id && ++reads === 1) {
          firstRead.resolve();
          await releaseRead.promise;
        }

        return row;
      };

      service.delete = (...args) => {
        const pending = originalDelete(...args);
        deleteEntered.resolve();

        return pending;
      };

      let responses: Response[];

      try {
        const updating = update({
          prompt: "Summarize today",
          version: versioned ? automation.version : undefined,
        });

        await firstRead.promise;

        const deleting = fixture.app.fetch(
          new Request(`http://localhost:4310/v1/automations/${automation.id}`, {
            headers: session.headers({
              "X-CSRF-Token": session.csrfToken,
            }),
            method: "DELETE",
          })
        );

        await deleteEntered.promise;
        releaseRead.resolve();
        responses = await Promise.all([updating, deleting]);
      } finally {
        releaseRead.resolve();
        db.getAutomation = originalRead;
        service.delete = originalDelete;
      }

      expect(responses.map(({ status }) => status)).toEqual([200, 204]);
      expect(await db.getAutomation(automation.id)).toBeNull();
      expect(await service.get(automation.id, orgId)).toBeNull();
      expect(
        (await service.listAll()).some((row) => row.id === automation.id)
      ).toBe(false);
      expect(changes).toBe(2);

      const found = await fixture.app.fetch(
        new Request(`http://localhost:4310/v1/automations/${automation.id}`, {
          headers: session.headers(),
        })
      );

      expect(found.status).toBe(404);
    });
  }

  test("an update that waits for a deletion gets 404 and leaves no row", async () => {
    const { automation, fixture, session, update } =
      await createUpdateFixture();

    const db = fixture.databaseAdapter;
    const deleteHeld = Promise.withResolvers<void>();
    const releaseDelete = Promise.withResolvers<void>();
    const updateRead = Promise.withResolvers<void>();
    const originalRead = db.getAutomation.bind(db);
    const originalDelete = db.deleteAutomation.bind(db);
    let holding = false;

    db.deleteAutomation = async (id) => {
      holding = true;
      deleteHeld.resolve();
      await releaseDelete.promise;

      return originalDelete(id);
    };

    db.getAutomation = async (id) => {
      const row = await originalRead(id);

      if (holding && id === automation.id) {
        updateRead.resolve();
      }

      return row;
    };

    let responses: Response[];

    try {
      const deleting = fixture.app.fetch(
        new Request(`http://localhost:4310/v1/automations/${automation.id}`, {
          headers: session.headers({
            "X-CSRF-Token": session.csrfToken,
          }),
          method: "DELETE",
        })
      );

      await deleteHeld.promise;

      const updating = update({ prompt: "Summarize today" });

      // An unserialized update reads the row here; a serialized one waits.
      await Promise.race([updateRead.promise, Bun.sleep(50)]);
      releaseDelete.resolve();
      responses = await Promise.all([deleting, updating]);
    } finally {
      releaseDelete.resolve();
      db.getAutomation = originalRead;
      db.deleteAutomation = originalDelete;
    }

    expect(responses.map(({ status }) => status)).toEqual([204, 404]);
    expect(await db.getAutomation(automation.id)).toBeNull();
  });

  test("foreign and missing rows do not notify or prevent a later deletion", async () => {
    const { automation, fixture, orgId } = await createUpdateFixture();
    const service = fixture.automationService;
    let changes = 0;

    service.setOnChange(() => {
      changes += 1;
    });

    expect(await service.delete(automation.id, "foreign_org")).toBe(false);
    expect(await service.get(automation.id, orgId)).not.toBeNull();
    expect(changes).toBe(0);
    expect(await service.delete("missing_automation", orgId)).toBe(false);
    expect(changes).toBe(0);
    expect(await service.delete(automation.id, orgId)).toBe(true);
    expect(changes).toBe(1);
    expect(await service.delete(automation.id, orgId)).toBe(false);
    expect(changes).toBe(1);
    expect(
      await fixture.databaseAdapter.getAutomation(automation.id)
    ).toBeNull();
  });

  test("an update on one ID does not block deletion of another ID", async () => {
    const { automation, fixture, orgId, update } = await createUpdateFixture();
    const service = fixture.automationService;

    const other = await service.create(
      orgId,
      {
        description: "Other report",
        name: "Other report",
        prompt: "Summarize another day",
        trigger: { type: "manual" },
      },
      PROFILE_ID
    );

    const db = fixture.databaseAdapter;
    const firstRead = Promise.withResolvers<void>();
    const releaseRead = Promise.withResolvers<void>();
    const originalRead = db.getAutomation.bind(db);
    let held = false;

    db.getAutomation = async (id) => {
      const row = await originalRead(id);

      if (id === automation.id && !held) {
        held = true;
        firstRead.resolve();
        await releaseRead.promise;
      }

      return row;
    };

    try {
      const updating = update({ prompt: "Summarize today" });

      await firstRead.promise;
      expect(await service.delete(other.id, orgId)).toBe(true);
      expect(await db.getAutomation(other.id)).toBeNull();
      releaseRead.resolve();
      expect((await updating).status).toBe(200);
      expect(await service.get(automation.id, orgId)).toMatchObject({
        prompt: "Summarize today",
      });
    } finally {
      releaseRead.resolve();
      db.getAutomation = originalRead;
    }
  });
});

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

describe("automation cron range validation over HTTP", () => {
  test("creates and lists an automation with a valid schedule", async () => {
    const fixture = createFixture();
    const { orgId, session } = await loginMember(fixture);

    const response = await fixture.app.fetch(
      new Request("http://localhost:4310/v1/automations", {
        body: JSON.stringify({
          description: "Schedule control",
          name: "Daily report",
          profileId: PROFILE_ID,
          prompt: "Summarize the week",
          trigger: { cron: "0 9 * * *", type: "schedule" },
        }),
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
          ...session.headers(),
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(201);
    expect(
      await fixture.databaseAdapter.listAutomationsForOrg(orgId)
    ).toHaveLength(1);

    const listed = await fixture.app.fetch(
      new Request("http://localhost:4310/v1/automations", {
        headers: session.headers(),
      })
    );

    expect(listed.status).toBe(200);
  });

  test.each([
    { cron: "60 * * * *", enabled: true },
    { cron: "60 * * * *", enabled: false },
    { cron: "every morning", enabled: true },
  ])(
    "rejects an invalid schedule before creation: %j",
    async ({ cron, enabled }) => {
      const fixture = createFixture();
      const { orgId, session } = await loginMember(fixture);

      const response = await fixture.app.fetch(
        new Request("http://localhost:4310/v1/automations", {
          body: JSON.stringify({
            description: "Invalid schedule",
            enabled,
            name: "Invalid minute",
            profileId: PROFILE_ID,
            prompt: "Summarize the week",
            trigger: { cron, type: "schedule" },
          }),
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            ...session.headers(),
          },
          method: "POST",
        })
      );

      const rows = await fixture.databaseAdapter.listAutomationsForOrg(orgId);

      const listed = await fixture.app.fetch(
        new Request("http://localhost:4310/v1/automations", {
          headers: session.headers(),
        })
      );

      expect(rows).toHaveLength(0);
      expect(response.status).toBe(400);
      expect(listed.status).toBe(200);
    }
  );

  test("rejects an invalid cron update without changing the stored automation", async () => {
    const fixture = createFixture();
    const { orgId, session } = await loginMember(fixture);

    const healthy = await fixture.automationService.create(
      orgId,
      {
        description: "Unaffected automation",
        name: "Manual control",
        prompt: "Summarize the week",
        trigger: { type: "manual" },
      },
      PROFILE_ID
    );

    const automation = await fixture.automationService.create(
      orgId,
      {
        description: "Valid schedule",
        name: "Daily report",
        prompt: "Summarize the week",
        trigger: { cron: "0 9 * * *", type: "schedule" },
      },
      PROFILE_ID
    );

    const before = await fixture.databaseAdapter.getAutomation(automation.id);

    const response = await fixture.app.fetch(
      new Request(`http://localhost:4310/v1/automations/${automation.id}`, {
        body: JSON.stringify({
          trigger: { cron: "0 24 * * *", type: "schedule" },
        }),
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
          ...session.headers(),
        },
        method: "PUT",
      })
    );

    const after = await fixture.databaseAdapter.getAutomation(automation.id);

    const listed = await fixture.app.fetch(
      new Request("http://localhost:4310/v1/automations", {
        headers: session.headers(),
      })
    );

    const loaded = await fixture.app.fetch(
      new Request(`http://localhost:4310/v1/automations/${automation.id}`, {
        headers: session.headers(),
      })
    );

    const healthyResponse = await fixture.app.fetch(
      new Request(`http://localhost:4310/v1/automations/${healthy.id}`, {
        headers: session.headers(),
      })
    );

    expect(healthyResponse.status).toBe(200);
    expect(after).toEqual(before);
    expect(response.status).toBe(400);
    expect(listed.status).toBe(200);
    expect(loaded.status).toBe(200);
  });
});

describe("one-time automation calendar dates over HTTP", () => {
  const invalidTrigger = {
    at: "2032-02-30T09:00:00.000Z",
    timezone: "UTC",
    type: "runAt",
  } as const;

  test.each([
    ["2032-02-29T09:00:00.000Z", "2032-02-29T09:00:00.000Z"],
    ["2032-02-29T16:00:00+07:00", "2032-02-29T09:00:00.000Z"],
    ["2032-02-29 GMT", "2032-02-29T00:00:00.000Z"],
    [invalidTrigger.at, null],
    ["2032-02-30Z", null],
  ] as const)(
    "validates the calendar date on create: %s",
    async (at, nextRunAt) => {
      const fixture = createFixture();
      const { orgId, session } = await loginMember(fixture);

      const response = await fixture.app.fetch(
        new Request("http://localhost:4310/v1/automations", {
          body: JSON.stringify({
            description: "Morning report",
            name: "Morning report",
            profileId: PROFILE_ID,
            prompt: "Summarize the week",
            trigger: { ...invalidTrigger, at },
          }),
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            ...session.headers(),
          },
          method: "POST",
        })
      );

      expect(
        await fixture.databaseAdapter.listAutomationsForOrg(orgId)
      ).toHaveLength(nextRunAt ? 1 : 0);
      expect(response.status).toBe(nextRunAt ? 201 : 400);

      if (nextRunAt) {
        expect(await response.json()).toMatchObject({
          automation: {
            nextRunAt,
            trigger: { ...invalidTrigger, at },
          },
        });
      }
    }
  );

  test("rejects February 30 on update without changing the saved row", async () => {
    const { automation, fixture, update } = await createUpdateFixture();
    const before = await fixture.databaseAdapter.getAutomation(automation.id);
    expect(before).not.toBeNull();

    const response = await update({
      trigger: invalidTrigger,
      version: automation.version,
    });

    expect(await fixture.databaseAdapter.getAutomation(automation.id)).toEqual(
      before
    );
    expect(response.status).toBe(400);
  });

  test("accepts a valid leap day on update", async () => {
    const { automation, fixture, update } = await createUpdateFixture();
    const trigger = { ...invalidTrigger, at: "2032-02-29T16:00:00+07:00" };

    const response = await update({ trigger, version: automation.version });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      automation: { nextRunAt: "2032-02-29T09:00:00.000Z", trigger },
    });
    expect(
      await fixture.databaseAdapter.getAutomation(automation.id)
    ).toMatchObject({
      definition: { trigger },
      version: automation.version + 1,
    });
  });

  test("can pause an existing automation with a legacy invalid date", async () => {
    const { automation, fixture, update } = await createUpdateFixture();
    const store = new DatabaseAutomationStore(fixture.databaseAdapter);
    await store.save({ ...automation, trigger: invalidTrigger });

    const response = await update({
      enabled: false,
      version: automation.version,
    });

    expect(response.status).toBe(200);
    expect(
      await fixture.databaseAdapter.getAutomation(automation.id)
    ).toMatchObject({
      definition: { trigger: invalidTrigger },
      enabled: false,
    });
  });
});

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
