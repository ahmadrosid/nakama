import { describe, expect, test } from "bun:test";
import { ManagedSecrets } from "../../services/managed-secrets";
import { setupTestConfigDir } from "../../test-config-dir";
import {
  createFixture,
  loginMember,
  PROFILE_ID,
} from "./automation-route-test-fixtures";

setupTestConfigDir("nakama-automation-webhook-secret-delete-");

describe("webhook secret and deletion", () => {
  test("a new secret cannot restore a row deleted at the same time", async () => {
    const fixture = createFixture({
      secrets: (db) =>
        new ManagedSecrets(db, Buffer.alloc(32, 7).toString("base64")),
    });

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

    const call = (method: "DELETE" | "POST", path = "") =>
      fixture.app.fetch(
        new Request(
          `http://localhost:4310/v1/automations/${automation.id}${path}`,
          {
            headers: {
              "X-CSRF-Token": session.csrfToken,
              ...session.headers(),
            },
            method,
          }
        )
      );

    const db = fixture.databaseAdapter;
    const secretStored = Promise.withResolvers<void>();
    const releaseSecret = Promise.withResolvers<void>();
    const originalPut = db.putAutomationWebhookSecret.bind(db);

    db.putAutomationWebhookSecret = async (record) => {
      await originalPut(record);
      secretStored.resolve();
      await releaseSecret.promise;
    };

    let responses: Response[];

    try {
      const creating = call("POST", "/webhook-secret");

      await secretStored.promise;

      const deleting = call("DELETE");

      // An unserialized delete completes here; a serialized one waits.
      await Promise.race([deleting, Bun.sleep(50)]);
      releaseSecret.resolve();
      responses = await Promise.all([creating, deleting]);
    } finally {
      releaseSecret.resolve();
      db.putAutomationWebhookSecret = originalPut;
    }

    expect(responses.map(({ status }) => status)).toEqual([200, 204]);
    expect(await db.getAutomation(automation.id)).toBeNull();
  });
});
