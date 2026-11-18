import { describe, expect, spyOn, test } from "bun:test";
import { createHmac } from "node:crypto";
import { AutomationRunner } from "../../services/automation-runner";
import { ManagedSecrets } from "../../services/managed-secrets";
import { setupTestConfigDir } from "../../test-config-dir";
import {
  createFixture,
  loginMember,
  PROFILE_ID,
  type RouteTestFixture,
} from "./automation-route-test-fixtures";

setupTestConfigDir("nakama-automation-webhook-routes-");

const TEST_SECRETS_KEY = Buffer.alloc(32, 7).toString("base64");

const ORG_A = "org_webhook_a";

const ORG_B = "org_webhook_b";

interface WebhookFixture extends RouteTestFixture {
  prompts: string[];
  release: () => void;
  runner: () => AutomationRunner;
}

function createWebhookFixture(
  options: { blockRuns?: boolean; secretsKey?: string } = {}
): WebhookFixture {
  const prompts: string[] = [];
  const gate = Promise.withResolvers<void>();
  let runner: AutomationRunner | undefined;

  if (!options.blockRuns) {
    gate.resolve();
  }

  const fixture = createFixture({
    agent: (automationService) => {
      // SAFETY: This test double supplies only the fields exercised by this test.
      runner = new AutomationRunner(automationService, {
        runAutomationPrompt: async (
          _orgId: string,
          _profileId: string,
          prompt: string
        ) => {
          prompts.push(prompt);
          await gate.promise;

          return "Reviewed";
        },
      } as never);
      const active = runner;

      return {
        providerConfigured: true,
        runAutomation: (id: string) => active.run(id),
        startAutomationFromWebhook: (
          ...args: Parameters<AutomationRunner["startFromWebhook"]>
        ) => active.startFromWebhook(...args),
      };
    },
    secrets: (db) =>
      new ManagedSecrets(db, options.secretsKey ?? TEST_SECRETS_KEY),
  });

  return {
    ...fixture,
    prompts,
    release: () => gate.resolve(),
    runner: () => {
      if (!runner) {
        throw new Error("Runner was not created.");
      }

      return runner;
    },
  };
}

async function seedWebhookAutomation(
  fixture: RouteTestFixture,
  orgId: string,
  trigger: "manual" | "webhook" = "webhook"
) {
  const now = new Date().toISOString();
  const profileId = `profile_${orgId}`;

  if (!(await fixture.databaseAdapter.getOrganizationById(orgId))) {
    await fixture.databaseAdapter.upsertOrganization({
      createdAt: now,
      id: orgId,
      name: orgId,
      slug: orgId.replaceAll("_", "-"),
      updatedAt: now,
    });
    await fixture.databaseAdapter.upsertProfile({
      createdAt: now,
      id: profileId,
      isDefault: true,
      isSuper: false,
      model: null,
      name: "Reviewer",
      orgId,
      systemPrompt: "",
      updatedAt: now,
    });
  }

  return fixture.automationService.create(
    orgId,
    {
      description: "Review pull requests",
      name: "PR review",
      prompt: "Review the pull request.",
      trigger: { type: trigger },
    },
    profileId
  );
}

function signWebhook(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function postWebhook(
  fixture: RouteTestFixture,
  automationId: string,
  options: {
    body?: string;
    contentType?: string;
    deliveryId?: string | null;
    event?: string;
    secret?: string;
    signature?: string | null;
  } = {}
) {
  const body = options.body ?? '{"action":"opened","number":7}';

  const headers = new Headers({
    "Content-Type": options.contentType ?? "application/json",
    "X-GitHub-Event": options.event ?? "pull_request",
  });

  const deliveryId =
    options.deliveryId === undefined ? crypto.randomUUID() : options.deliveryId;

  if (deliveryId !== null) {
    headers.set("X-GitHub-Delivery", deliveryId);
  }

  const signature =
    options.signature === undefined
      ? signWebhook(options.secret ?? "", body)
      : options.signature;

  if (signature !== null) {
    headers.set("X-Hub-Signature-256", signature);
  }

  return fixture.app.fetch(
    new Request(
      `http://localhost:4310/v1/automations/${automationId}/webhook`,
      {
        body,
        headers,
        method: "POST",
      }
    )
  );
}

async function waitUntilIdle(fixture: WebhookFixture, automationId: string) {
  while (fixture.runner().isRunning(automationId)) {
    await Bun.sleep(1);
  }
}

describe("automation webhook", () => {
  test("a signed request starts a run marked as a webhook run", async () => {
    const fixture = createWebhookFixture();
    const automation = await seedWebhookAutomation(fixture, ORG_A);

    const secret = await fixture.automationService.createWebhookSecret(
      automation.id,
      ORG_A,
      "user_a"
    );

    const response = await postWebhook(fixture, automation.id, { secret });

    expect(response.status).toBe(202);
    // SAFETY: The 202 response body is `{ runId }` per the route contract.
    const { runId } = (await response.json()) as { runId: string };
    await waitUntilIdle(fixture, automation.id);

    const runs = await fixture.automationService.listRuns(automation.id, ORG_A);
    expect(runs.map((run) => [run.id, run.source, run.status])).toEqual([
      [runId, "webhook", "completed"],
    ]);
    expect(fixture.prompts[0]).toContain('"number":7');
  });

  test("a bad, missing or foreign signature gets 401 and starts nothing", async () => {
    const fixture = createWebhookFixture();
    const automation = await seedWebhookAutomation(fixture, ORG_A);

    const secret = await fixture.automationService.createWebhookSecret(
      automation.id,
      ORG_A,
      "user_a"
    );

    const foreign = await seedWebhookAutomation(fixture, ORG_B);

    const foreignSecret = await fixture.automationService.createWebhookSecret(
      foreign.id,
      ORG_B,
      "user_a"
    );

    const deliveryId = "delivery-1";
    const runReads = spyOn(fixture.databaseAdapter, "listAutomationRuns");

    for (const options of [
      { signature: null },
      { signature: "sha256=" },
      { secret: "not-the-secret" },
      { secret: foreignSecret },
    ]) {
      expect(
        (await postWebhook(fixture, automation.id, { ...options, deliveryId }))
          .status
      ).toBe(401);
    }

    // Unsigned callers must not trigger the run-history reads of `get`.
    expect(runReads).not.toHaveBeenCalled();
    runReads.mockRestore();

    expect(
      await fixture.automationService.listRuns(automation.id)
    ).toHaveLength(0);

    // A rejected request must not use up the delivery id.
    expect(
      (await postWebhook(fixture, automation.id, { deliveryId, secret })).status
    ).toBe(202);
    await waitUntilIdle(fixture, automation.id);
  });

  test("unknown ids, other triggers, missing secrets and archived orgs get 401", async () => {
    const fixture = createWebhookFixture();
    const manual = await seedWebhookAutomation(fixture, ORG_A, "manual");
    const noSecret = await seedWebhookAutomation(fixture, ORG_A);
    const archived = await seedWebhookAutomation(fixture, ORG_B);

    const archivedSecret = await fixture.automationService.createWebhookSecret(
      archived.id,
      ORG_B,
      "user_a"
    );

    const org = await fixture.databaseAdapter.getOrganizationById(ORG_B);

    if (!org) {
      throw new Error("Missing org.");
    }

    await fixture.databaseAdapter.upsertOrganization({
      ...org,
      archivedAt: new Date().toISOString(),
    });

    expect((await postWebhook(fixture, "automation_missing")).status).toBe(401);
    expect((await postWebhook(fixture, "%25")).status).toBe(401);
    expect((await postWebhook(fixture, manual.id)).status).toBe(401);
    expect((await postWebhook(fixture, noSecret.id)).status).toBe(401);
    expect(
      (await postWebhook(fixture, archived.id, { secret: archivedSecret }))
        .status
    ).toBe(401);
    expect(await fixture.automationService.listRuns(archived.id)).toHaveLength(
      0
    );
  });

  test("a repeated delivery id starts no second run", async () => {
    const fixture = createWebhookFixture();
    const automation = await seedWebhookAutomation(fixture, ORG_A);

    const secret = await fixture.automationService.createWebhookSecret(
      automation.id,
      ORG_A,
      "user_a"
    );

    const first = await postWebhook(fixture, automation.id, {
      deliveryId: "delivery-1",
      secret,
    });

    expect(first.status).toBe(202);
    await waitUntilIdle(fixture, automation.id);

    const repeated = await postWebhook(fixture, automation.id, {
      deliveryId: "delivery-1",
      secret,
    });

    expect(repeated.status).toBe(409);
    expect(
      await fixture.automationService.listRuns(automation.id)
    ).toHaveLength(1);
  });

  test("a disabled automation or an active run gets 409", async () => {
    const fixture = createWebhookFixture({ blockRuns: true });
    const automation = await seedWebhookAutomation(fixture, ORG_A);

    const secret = await fixture.automationService.createWebhookSecret(
      automation.id,
      ORG_A,
      "user_a"
    );

    expect((await postWebhook(fixture, automation.id, { secret })).status).toBe(
      202
    );
    expect((await postWebhook(fixture, automation.id, { secret })).status).toBe(
      409
    );

    fixture.release();
    await waitUntilIdle(fixture, automation.id);
    await fixture.automationService.update(automation.id, ORG_A, {
      enabled: false,
    });

    expect((await postWebhook(fixture, automation.id, { secret })).status).toBe(
      409
    );
    expect(
      await fixture.automationService.listRuns(automation.id)
    ).toHaveLength(1);
  });

  test("a GitHub ping is accepted after the signature check and starts nothing", async () => {
    const fixture = createWebhookFixture();
    const automation = await seedWebhookAutomation(fixture, ORG_A);

    const secret = await fixture.automationService.createWebhookSecret(
      automation.id,
      ORG_A,
      "user_a"
    );

    const deliveryId = "delivery-1";

    expect(
      (
        await postWebhook(fixture, automation.id, {
          deliveryId,
          event: "ping",
          secret,
        })
      ).status
    ).toBe(200);
    expect(
      (
        await postWebhook(fixture, automation.id, {
          event: "ping",
          secret: "wrong",
        })
      ).status
    ).toBe(401);
    // GitHub defaults to form encoding; a ping must fail setup the same way
    // real events would.
    const form = "payload=%7B%7D";
    expect(
      (
        await postWebhook(fixture, automation.id, {
          body: form,
          contentType: "application/x-www-form-urlencoded",
          event: "ping",
          secret,
        })
      ).status
    ).toBe(415);
    expect(
      (
        await postWebhook(fixture, automation.id, {
          body: form,
          contentType: "application/x-www-form-urlencoded",
          event: "ping",
          secret: "wrong",
        })
      ).status
    ).toBe(401);
    expect(
      await fixture.automationService.listRuns(automation.id)
    ).toHaveLength(0);

    // A ping must not use up the delivery id.
    expect(
      (await postWebhook(fixture, automation.id, { deliveryId, secret })).status
    ).toBe(202);
    await waitUntilIdle(fixture, automation.id);
  });

  test("rejects bad delivery ids, bodies and content types", async () => {
    const fixture = createWebhookFixture();
    const automation = await seedWebhookAutomation(fixture, ORG_A);

    const secret = await fixture.automationService.createWebhookSecret(
      automation.id,
      ORG_A,
      "user_a"
    );

    const cases: Array<[Parameters<typeof postWebhook>[2], number]> = [
      [{ deliveryId: null, secret }, 400],
      [{ deliveryId: "d".repeat(129), secret }, 400],
      [{ body: "{not json", secret }, 400],
      [{ body: "", secret }, 400],
      [{ contentType: "application/x-www-form-urlencoded", secret }, 415],
      [{ body: JSON.stringify({ text: "x".repeat(256 * 1024) }), secret }, 413],
    ];

    // An unknown id gets the same 413, so the size check reveals nothing.
    expect(
      (
        await postWebhook(fixture, "automation_missing", {
          body: JSON.stringify({ text: "x".repeat(256 * 1024) }),
          secret,
        })
      ).status
    ).toBe(413);

    for (const [options, status] of cases) {
      expect((await postWebhook(fixture, automation.id, options)).status).toBe(
        status
      );
    }

    expect(
      await fixture.automationService.listRuns(automation.id)
    ).toHaveLength(0);
  });

  test("answers the same 401 as an unknown id when a saved secret cannot be read", async () => {
    const keyed = createWebhookFixture();
    const automation = await seedWebhookAutomation(keyed, ORG_A);

    const secret = await keyed.automationService.createWebhookSecret(
      automation.id,
      ORG_A,
      "user_a"
    );

    const keyless = createFixture({
      agent: () => ({ providerConfigured: true }),
      databaseAdapter: keyed.databaseAdapter,
      secrets: (db) => new ManagedSecrets(db, ""),
    });

    const logged = spyOn(console, "error").mockImplementation(() => {});

    const real = await postWebhook(keyless, automation.id, { secret });
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();

    const unknown = await postWebhook(keyless, "automation_unknown", {
      secret,
    });

    expect(real.status).toBe(401);
    expect(await real.json()).toEqual(await unknown.json());
  });

  test("a secret whose maker no longer runs the automation gets 401", async () => {
    const fixture = createWebhookFixture();
    const automation = await seedWebhookAutomation(fixture, ORG_A);

    const secret = await fixture.automationService.createWebhookSecret(
      automation.id,
      ORG_A,
      "user_a"
    );

    await fixture.automationService.update(
      automation.id,
      ORG_A,
      { prompt: "Summarize it." },
      { orgRole: "member", userId: "user_b" }
    );

    const response = await postWebhook(fixture, automation.id, { secret });

    expect(response.status).toBe(401);
    expect(
      await fixture.automationService.listRuns(automation.id, ORG_A)
    ).toEqual([]);
    expect(fixture.prompts).toEqual([]);
  });

  test("a member creates a secret shown once for a webhook automation", async () => {
    const fixture = createWebhookFixture();
    const { orgId, session } = await loginMember(fixture);

    const call = (automationId: string) =>
      fixture.app.fetch(
        new Request(
          `http://localhost:4310/v1/automations/${automationId}/webhook-secret`,
          {
            headers: {
              "X-CSRF-Token": session.csrfToken,
              ...session.headers(),
            },
            method: "POST",
          }
        )
      );

    const automation = await fixture.automationService.create(
      orgId,
      {
        description: "",
        name: "PR review",
        prompt: "Review the pull request.",
        trigger: { type: "webhook" },
      },
      PROFILE_ID,
      { orgRole: "admin", userId: "user_other" }
    );

    const runAsUserId = async () =>
      (await fixture.automationService.get(automation.id, orgId))?.runAsUserId;

    expect(await runAsUserId()).toBe("user_other");

    const response = await call(automation.id);
    expect(response.status).toBe(200);
    expect(await runAsUserId()).toBe("user_route_member");
    // SAFETY: The 200 response body is `{ secret }` per the route contract.
    const { secret } = (await response.json()) as { secret: string };

    expect((await postWebhook(fixture, automation.id, { secret })).status).toBe(
      202
    );
    await waitUntilIdle(fixture, automation.id);

    const manual = await fixture.automationService.create(
      orgId,
      {
        description: "",
        name: "Manual",
        prompt: "Say hi",
        trigger: { type: "manual" },
      },
      PROFILE_ID
    );

    expect((await call(manual.id)).status).toBe(400);

    const foreign = await seedWebhookAutomation(fixture, ORG_B);
    expect((await call(foreign.id)).status).toBe(404);
    // `%25` decodes to `%`, which must not be decoded a second time.
    expect((await call("%25")).status).toBe(404);
  });

  test("an id with a slash resolves on the public and the member route", async () => {
    const fixture = createWebhookFixture();
    const { orgId, session } = await loginMember(fixture);

    const created = await fixture.automationService.create(
      orgId,
      {
        description: "",
        name: "PR review",
        prompt: "Review the pull request.",
        trigger: { type: "webhook" },
      },
      PROFILE_ID
    );

    const id = "automation/with slash";
    const stored = await fixture.databaseAdapter.getAutomation(created.id);
    await fixture.databaseAdapter.upsertAutomation({ ...stored!, id });
    const encodedId = encodeURIComponent(id);

    const secretResponse = await fixture.app.fetch(
      new Request(
        `http://localhost:4310/v1/automations/${encodedId}/webhook-secret`,
        {
          headers: {
            "X-CSRF-Token": session.csrfToken,
            ...session.headers(),
          },
          method: "POST",
        }
      )
    );

    expect(secretResponse.status).toBe(200);
    // SAFETY: The 200 response body is `{ secret }` per the route contract.
    const { secret } = (await secretResponse.json()) as { secret: string };

    const body = '{"action":"opened"}';

    const response = await fixture.app.fetch(
      new Request(`http://localhost:4310/v1/automations/${encodedId}/webhook`, {
        body,
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Delivery": crypto.randomUUID(),
          "X-GitHub-Event": "pull_request",
          "X-Hub-Signature-256": signWebhook(secret, body),
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(202);
    await waitUntilIdle(fixture, id);
  });

  test("creating a secret without NAKAMA_SECRETS_KEY gets 400", async () => {
    const fixture = createWebhookFixture({ secretsKey: "" });
    const { orgId, session } = await loginMember(fixture);

    const automation = await fixture.automationService.create(
      orgId,
      {
        description: "",
        name: "PR review",
        prompt: "Review the pull request.",
        trigger: { type: "webhook" },
      },
      PROFILE_ID
    );

    const response = await fixture.app.fetch(
      new Request(
        `http://localhost:4310/v1/automations/${automation.id}/webhook-secret`,
        {
          headers: {
            "X-CSRF-Token": session.csrfToken,
            ...session.headers(),
          },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(400);
  });
});
