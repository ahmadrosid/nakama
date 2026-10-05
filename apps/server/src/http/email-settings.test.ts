import { afterEach, describe, expect, test } from "bun:test";
import {
  getUserConfigPath,
  readEnvValue,
  readTextOrNull,
  setManagedSecretResolver,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../services/agent-service";
import { ManagedSecrets } from "../services/managed-secrets";
import { setupTestConfigDir } from "../test-config-dir";
import { createMinimalHonoApp } from "./test-app-helpers";
import { setupFreshInstallSession } from "./test-session-helpers";

setupTestConfigDir("nakama-email-route-");
afterEach(() => {
  delete process.env.NAKAMA_EMAIL_PASSWORD;
  setManagedSecretResolver(
    async (_scope, _name, envNames) =>
      envNames.map((name) => readEnvValue(process.env, name)).find(Boolean) ??
      null
  );
});

describe("email settings routes", () => {
  test("org admin can read and update email settings without exposing password", async () => {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const secrets = new ManagedSecrets(
      databaseAdapter,
      Buffer.alloc(32, 1).toString("base64")
    );
    setManagedSecretResolver(
      async (scope, name, envNames) =>
        (await secrets.resolve(scope, name, envNames)).value
    );
    const { app } = createMinimalHonoApp({
      agent: new AgentService(null, null, databaseAdapter, undefined, secrets),
      databaseAdapter,
    });

    const session = await setupFreshInstallSession(app, databaseAdapter);

    const getEmpty = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        headers: session.headers(),
      })
    );
    expect(getEmpty.status).toBe(200);
    const emptyBody = (await getEmpty.json()) as Record<string, unknown>;
    expect(emptyBody.configured).toBe(false);
    expect("password" in emptyBody).toBe(false);

    const putResponse = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        body: JSON.stringify({
          from: "admin@example.com",
          imapHost: "imap.example.com",
          smtpHost: "smtp.example.com",
          username: "admin@example.com",
        }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "PUT",
      })
    );
    expect(putResponse.status).toBe(200);
    const legacyPut = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        body: JSON.stringify({ password: "should-not-save" }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "PUT",
      })
    );
    expect(legacyPut.status).toBe(400);
    const secretResponse = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email/secret", {
        body: JSON.stringify({ password: "secret-pass" }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "PUT",
      })
    );
    expect(secretResponse.status).toBe(200);
    const saved = (await putResponse.json()) as {
      configured: boolean;
      passwordMasked: string | null;
    };
    expect(saved.configured).toBe(false);
    expect(saved.passwordMasked).not.toBe("secret-pass");

    const putWithoutPassword = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        body: JSON.stringify({
          smtpHost: "smtp2.example.com",
        }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "PUT",
      })
    );
    expect(putWithoutPassword.status).toBe(200);

    const getSaved = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        headers: session.headers(),
      })
    );
    const savedBody = (await getSaved.json()) as {
      smtpHost: string | null;
      passwordMasked: string | null;
      configured: boolean;
      source: string;
    };
    expect(savedBody.smtpHost).toBe("smtp2.example.com");
    expect(savedBody.passwordMasked).toBeNull();
    expect(savedBody.configured).toBe(true);
    expect(savedBody.source).toBe("settings");
    expect(await readTextOrNull(getUserConfigPath())).not.toContain(
      "secret-pass"
    );

    const authHeaders = session.headers({ "X-CSRF-Token": session.csrfToken });
    process.env.NAKAMA_EMAIL_PASSWORD = "override";
    const overridden = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        headers: session.headers(),
      })
    );
    expect((await overridden.json()).source).toBe("environment");
    delete process.env.NAKAMA_EMAIL_PASSWORD;
    const missing = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        headers: session.headers(),
      })
    );
    expect((await missing.json()).source).toBe("missing");
    const selected = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email/secret/use-stored", {
        headers: authHeaders,
        method: "POST",
      })
    );
    expect((await selected.json()).source).toBe("settings");
    const cleared = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email/secret", {
        headers: authHeaders,
        method: "DELETE",
      })
    );
    expect((await cleared.json()).source).toBe("missing");
  });
});
