import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { ManagedSecrets } from "./managed-secrets";

describe("ManagedSecrets", () => {
  test("encrypts values and keeps environment overrides pinned", async () => {
    const db = createInMemoryDatabaseAdapter();
    const key = randomBytes(32).toString("base64");
    const secrets = new ManagedSecrets(db, key);

    await secrets.save("global", "provider:one", "sk-saved");
    const stored = await db.getManagedSecret("global", "provider:one");
    expect(stored?.encryptedValue).not.toContain("sk-saved");
    expect(
      await secrets.resolve("global", "provider:one", ["TEST_PROVIDER_KEY"], {})
    ).toMatchObject({ source: "settings", value: "sk-saved" });

    expect(
      await secrets.resolve("global", "provider:one", ["TEST_PROVIDER_KEY"], {
        TEST_PROVIDER_KEY: "sk-env",
      })
    ).toMatchObject({ source: "environment", value: "sk-env" });
    expect(
      await secrets.resolve("global", "provider:one", ["TEST_PROVIDER_KEY"], {})
    ).toMatchObject({ source: "missing", value: null });

    await secrets.useStored("global", "provider:one");
    expect(
      await secrets.resolve("global", "provider:one", ["TEST_PROVIDER_KEY"], {})
    ).toMatchObject({ source: "settings", value: "sk-saved" });
  });

  test("rejects the wrong master key and identity", async () => {
    const db = createInMemoryDatabaseAdapter();
    const secrets = new ManagedSecrets(db, randomBytes(32).toString("base64"));
    await secrets.save("org-a", "tool:one", "secret-value");

    const wrong = new ManagedSecrets(db, randomBytes(32).toString("base64"));
    await expect(wrong.checkIntegrity()).rejects.toThrow();

    const original = await db.getManagedSecret("org-a", "tool:one");
    await db.putManagedSecret({
      encryptedValue: original!.encryptedValue,
      name: "tool:one",
      scope: "org-b",
      source: "settings",
    });
    await expect(secrets.resolve("org-b", "tool:one")).rejects.toThrow();
  });

  test("rotates every saved value before the old key stops working", async () => {
    const db = createInMemoryDatabaseAdapter();
    const oldKey = randomBytes(32).toString("base64");
    const newKey = randomBytes(32).toString("base64");
    const oldSecrets = new ManagedSecrets(db, oldKey);
    await oldSecrets.save("global", "email", "first");
    await oldSecrets.save("org-a", "tool:one", "second");
    await oldSecrets.rotateKey(newKey);
    const newSecrets = new ManagedSecrets(db, newKey);
    expect((await newSecrets.resolve("global", "email")).value).toBe("first");
    expect((await newSecrets.resolve("org-a", "tool:one")).value).toBe(
      "second"
    );
    await expect(oldSecrets.checkIntegrity()).rejects.toThrow();
  });

  test("migrates legacy files before removing plaintext", async () => {
    const root = await mkdtemp(join(tmpdir(), "nakama-secret-migration-"));
    try {
      const toolSection = Buffer.from(
        JSON.stringify(["org-a", "tool-a"])
      ).toString("base64url");
      await writeFile(
        join(root, "config.ini"),
        [
          "[provider.provider-a]",
          "type=openai_compatible",
          "api_key=provider-secret",
          "",
          "[web_search]",
          "provider=exa",
          "api_key=search-secret",
          "",
          `[tool-key.${toolSection}]`,
          "api_key=tool-secret",
          "",
          "[email]",
          "username=test@example.com",
          "password=email-secret",
          "",
        ].join("\n")
      );
      await mkdir(join(root, "composio"));
      await writeFile(
        join(root, "composio", "config.ini"),
        "api_key=composio-secret\n"
      );

      const db = createInMemoryDatabaseAdapter();
      const secrets = new ManagedSecrets(
        db,
        randomBytes(32).toString("base64")
      );
      await secrets.migrateLegacyFiles(root);
      const config = await readFile(join(root, "config.ini"), "utf8");
      expect(config).not.toContain("provider-secret");
      expect(config).not.toContain("search-secret");
      expect(config).not.toContain("tool-secret");
      expect(config).not.toContain("email-secret");
      expect(
        (await secrets.resolve("global", "provider:provider-a")).value
      ).toBe("provider-secret");
      expect((await secrets.resolve("org-a", "tool:tool-a")).value).toBe(
        "tool-secret"
      );
      expect((await secrets.resolve("global", "email")).value).toBe(
        "email-secret"
      );
      expect((await secrets.resolve("global", "composio")).value).toBe(
        "composio-secret"
      );
      await expect(
        readFile(join(root, "composio", "config.ini"))
      ).rejects.toThrow();
      await secrets.migrateLegacyFiles(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("leaves an unknown legacy key in place until its owner is identified", async () => {
    const root = await mkdtemp(join(tmpdir(), "nakama-unknown-secret-"));
    try {
      await writeFile(
        join(root, "config.ini"),
        "[unknown]\napi_key=do-not-lose-me\n"
      );
      const secrets = new ManagedSecrets(
        createInMemoryDatabaseAdapter(),
        randomBytes(32).toString("base64")
      );
      await expect(secrets.migrateLegacyFiles(root)).rejects.toThrow(
        "unknown API key section"
      );
      expect(await readFile(join(root, "config.ini"), "utf8")).toContain(
        "do-not-lose-me"
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("does not keep a legacy fallback behind an environment override", async () => {
    const root = await mkdtemp(join(tmpdir(), "nakama-env-migration-"));
    const previous = process.env.EXA_API_KEY;
    process.env.EXA_API_KEY = "active-env-key";
    try {
      await writeFile(
        join(root, "config.ini"),
        "[web_search]\nprovider=exa\napi_key=old-file-key\n"
      );
      const db = createInMemoryDatabaseAdapter();
      const secrets = new ManagedSecrets(db);
      await secrets.migrateLegacyFiles(root);
      expect(
        (await db.getManagedSecret("global", "web-search:exa"))?.encryptedValue
      ).toBeNull();
      expect(
        (await secrets.resolve("global", "web-search:exa", ["EXA_API_KEY"]))
          .value
      ).toBe("active-env-key");
      delete process.env.EXA_API_KEY;
      expect(
        (await secrets.resolve("global", "web-search:exa", ["EXA_API_KEY"]))
          .source
      ).toBe("missing");
      expect(await readFile(join(root, "config.ini"), "utf8")).not.toContain(
        "old-file-key"
      );
    } finally {
      if (previous === undefined) {
        delete process.env.EXA_API_KEY;
      } else {
        process.env.EXA_API_KEY = previous;
      }
      await rm(root, { force: true, recursive: true });
    }
  });
});
