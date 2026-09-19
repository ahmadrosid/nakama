import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createMinimalHonoApp } from "../../server/src/http/test-app-helpers";
import { setupFreshInstallSession } from "../../server/src/http/test-session-helpers";
import { setupTestConfigDir } from "../../server/src/test-config-dir";
import {
  createRemoteConnection,
  LoginForm,
  parseConnectionArgs,
  readPassword,
} from "./setup";

test("login form edits the server, switches fields, and never renders the password", async () => {
  const done = Promise.withResolvers<void>();
  let attempts = 0;
  const form = new LoginForm(
    "https://example.com",
    async (serverUrl, email, password) => {
      attempts += 1;
      expect(serverUrl).toBe("https://cloud.example.com");
      expect(email).toBe("person@example.com");
      expect(password).toBe("秘密🔑");
    },
    () => {},
    (error) => (error ? done.reject(error) : done.resolve())
  );
  expect(form.render(80)[1]).toContain("https://example.com");
  form.handleInput("\x15");
  form.handleInput("http://cloud.example.com");
  form.handleInput("\t");
  form.handleInput("person@example.com");
  expect(form.render(80)[3]).toContain("\x1b[7m");
  form.handleInput("\t");
  expect(form.render(80)[3]).not.toContain("\x1b[7m");
  expect(form.render(80)[4]).toContain("\x1b[7m");
  form.handleInput("\x1b[Z");
  expect(form.render(80)[3]).toContain("\x1b[7m");
  expect(form.render(80)[4]).not.toContain("\x1b[7m");
  form.handleInput("\t");
  form.handleInput("\x1b[200~秘密🔑\x1b[201~");
  expect(form.render(80).join("\n")).not.toContain("秘密");
  expect(form.render(8).every((line) => !line.includes("秘密"))).toBe(true);
  form.handleInput("\r");
  expect(attempts).toBe(0);
  expect(form.render(80)[1]).toContain("\x1b[7m");
  form.handleInput("\x15");
  form.handleInput("https://cloud.example.com/");
  form.handleInput("\x1b[Z");
  expect(form.render(80)[4]).toContain("\x1b[7m");
  form.handleInput("\r");
  await done.promise;
  expect(attempts).toBe(1);
  expect(form.render(80).join("\n")).not.toContain("person@example.com");
});

class MockStdin extends EventEmitter {
  isTTY = true;
  rawModeEnabled = false;
  paused = true;
  failOnResume = false;

  setRawMode(enabled: boolean) {
    this.rawModeEnabled = enabled;
    return this;
  }

  isPaused() {
    return this.paused;
  }

  resume() {
    this.paused = false;
    if (this.failOnResume) {
      throw new Error("simulated stdin failure");
    }
    return this;
  }

  pause() {
    this.paused = true;
    return this;
  }

  setEncoding() {
    return this;
  }
}

describe("readPassword", () => {
  test("restores raw mode after Enter", async () => {
    const stdin = new MockStdin();
    const originalStdin = process.stdin;
    const originalWrite = process.stdout.write;
    process.stdout.write = () => true;
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: stdin,
    });

    try {
      const promise = readPassword("Password: ");
      stdin.emit("data", "hunter2\n");
      await expect(promise).resolves.toBe("hunter2");
      expect(stdin.rawModeEnabled).toBe(false);
    } finally {
      Object.defineProperty(process, "stdin", {
        configurable: true,
        value: originalStdin,
      });
      process.stdout.write = originalWrite;
    }
  });

  test("restores raw mode when stdin setup throws synchronously", async () => {
    const stdin = new MockStdin();
    stdin.failOnResume = true;
    const originalStdin = process.stdin;
    const originalWrite = process.stdout.write;
    process.stdout.write = () => true;
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: stdin,
    });

    try {
      await expect(readPassword("Password: ")).rejects.toThrow(
        "simulated stdin failure"
      );
      expect(stdin.rawModeEnabled).toBe(false);
      expect(stdin.listenerCount("data")).toBe(0);
    } finally {
      Object.defineProperty(process, "stdin", {
        configurable: true,
        value: originalStdin,
      });
      process.stdout.write = originalWrite;
    }
  });
});

setupTestConfigDir("nakama-cli-remote-test-");

test("login stores only tokens; restored sessions authenticate and logout revokes them", async () => {
  const { app, databaseAdapter } = createMinimalHonoApp();
  await setupFreshInstallSession(
    { fetch: app.fetch as typeof fetch },
    databaseAdapter
  );
  let saved: string | null = null;
  const options = {
    fetch: ((input, init) => {
      expect(init?.redirect).toBe("error");
      return app.fetch(new Request(input, init));
    }) as typeof fetch,
    secretStore: {
      delete: async () => {
        saved = null;
        return true;
      },
      get: async () => saved,
      set: async ({ value }: { value: string }) => {
        saved = value;
      },
    },
  };
  const connection = await createRemoteConnection(
    "https://example.com",
    options
  );
  await expect(
    connection.login("admin@example.com", "wrong")
  ).rejects.toMatchObject({ status: 401 });
  expect(saved).toBeNull();
  const user = await connection.login("admin@example.com", "password123");
  const tokens = JSON.parse(saved!);
  expect(Object.keys(tokens).sort()).toEqual(["csrf", "session"]);
  const restored = await createRemoteConnection("https://example.com", options);
  expect((await restored.client.getMe()).id).toBe(user.id);
  expect((await restored.client.listUserOrgs()).orgs.length).toBe(1);
  await restored.logout(); // Requires both the session cookie and CSRF header.
  expect(saved).toBeNull();
  saved = JSON.stringify(tokens);
  const expired = await createRemoteConnection("https://example.com", options);
  await expect(expired.client.getMe()).rejects.toMatchObject({ status: 401 });
  expect(saved).toBeNull();
});

test("server arguments reject insecure URLs and embedded credentials", () => {
  expect(
    parseConnectionArgs(["login", "--server", "https://example.com/"])
  ).toEqual({ command: "login", serverUrl: "https://example.com" });
  for (const url of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/?token=secret",
    "https://example.com/#secret",
  ]) {
    expect(() => parseConnectionArgs(["--server", url])).toThrow();
  }
  expect(() => parseConnectionArgs(["--server"])).toThrow();
});
