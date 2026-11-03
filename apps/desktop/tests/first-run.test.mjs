import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkCloudServer,
  clearDesktopConfig,
  createLocalSignIn,
  defaultCloudUrl,
  normalizeCloudUrl,
  readDesktopConfig,
  watchCloudSignOut,
  writeDesktopConfig,
} from "../first-run.mjs";

describe("server address", () => {
  test("keeps the origin of an HTTPS address, and allows HTTP only on this computer", () => {
    expect(normalizeCloudUrl(" https://team.example.com/chat?x=1 ")).toBe(
      "https://team.example.com"
    );
    expect(normalizeCloudUrl("http://localhost:4320/")).toBe(
      "http://localhost:4320"
    );
    expect(() => normalizeCloudUrl("http://team.example.com")).toThrow();
    expect(() => normalizeCloudUrl("https://user:pass@example.com")).toThrow();
    expect(() => normalizeCloudUrl("withnakama")).toThrow();
  });

  test("Sign in uses withnakama.com unless NAKAMA_CLOUD_URL names another server", () => {
    expect(defaultCloudUrl({})).toBe("https://withnakama.com");
    expect(
      defaultCloudUrl({ NAKAMA_CLOUD_URL: "http://localhost:4320/" })
    ).toBe("http://localhost:4320");
    expect(() =>
      defaultCloudUrl({ NAKAMA_CLOUD_URL: "http://staging.example.com" })
    ).toThrow();
  });

  test("a server must answer /health with an apiVersion", async () => {
    const answer =
      (body, status = 200) =>
      async () =>
        new Response(JSON.stringify(body), { status });

    await checkCloudServer("https://a.test", answer({ apiVersion: 1 }));
    await expect(
      checkCloudServer("https://example.com", answer({ hello: "world" }))
    ).rejects.toThrow();
    await expect(
      checkCloudServer("https://a.test", answer({ apiVersion: 1 }, 500))
    ).rejects.toThrow();
  });
});

test("a saved choice reads back; a broken file means ask again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nakama-desktop-config-"));

  expect(await readDesktopConfig(dir)).toBeNull();

  await writeDesktopConfig(dir, { choice: "cloud" });
  expect(await readDesktopConfig(dir)).toEqual({ choice: "cloud" });

  await writeFile(join(dir, "desktop.json"), "{not json");
  expect(await readDesktopConfig(dir)).toBeNull();

  await writeDesktopConfig(dir, { choice: "cloud" });
  await clearDesktopConfig(dir);
  expect(await readDesktopConfig(dir)).toBeNull();
  await clearDesktopConfig(dir);
});

test("only a successful sign out of Nakama Cloud asks again", () => {
  let listener = null;
  let signOuts = 0;

  watchCloudSignOut(
    {
      webRequest: {
        onCompleted: (_filter, callback) => {
          listener = callback;
        },
      },
    },
    "http://127.0.0.1:5000",
    () => {
      signOuts += 1;
    }
  );

  const done = (method, url, statusCode) =>
    listener({ method, statusCode, url });

  done("GET", "http://127.0.0.1:5000/v1/nakama-cloud", 200);
  done("DELETE", "http://127.0.0.1:5000/v1/nakama-cloud", 500);
  done("DELETE", "http://127.0.0.1:5000/v1/nakama-cloud/sign-in", 204);
  done("DELETE", "https://evil.test/v1/nakama-cloud", 204);
  expect(signOuts).toBe(0);

  done("DELETE", "http://127.0.0.1:5000/v1/nakama-cloud", 204);
  expect(signOuts).toBe(1);
});

describe("local sign-in", () => {
  async function setup() {
    const dataDir = await mkdtemp(join(tmpdir(), "nakama-desktop-data-"));
    await writeFile(join(dataDir, "local-auth-token"), "token-123\n");
    const calls = [];
    let statusCalls = 0;

    const fetchImpl = async (url, init = {}) => {
      calls.push({
        authorization: init.headers?.authorization,
        method: init.method ?? "GET",
        url: String(url),
      });

      if (init.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      if (String(url).endsWith("/v1/nakama-cloud/sign-in")) {
        return Response.json({
          connectUrl: "https://a.test/desktop/connect?state=s",
        });
      }

      statusCalls += 1;

      return Response.json({ signedIn: statusCalls >= 2 });
    };

    const signIn = createLocalSignIn({
      dataDir,
      fetchImpl,
      serverUrl: "http://127.0.0.1:5000",
    });

    return { calls, signIn };
  }

  test("starts sign-in with the local token, opens the browser, and waits until signed in", async () => {
    const { calls, signIn } = await setup();
    const opened = [];

    await signIn({
      cloudUrl: "https://a.test",
      openExternal: async (url) => {
        opened.push(url);
      },
      wait: 1,
    });

    expect(opened).toEqual(["https://a.test/desktop/connect?state=s"]);
    // An old account is signed out first, so "signed in" is this one.
    expect(calls[0]).toMatchObject({
      method: "DELETE",
      url: "http://127.0.0.1:5000/v1/nakama-cloud",
    });
    expect(calls[1]).toMatchObject({
      authorization: "Bearer token-123",
      method: "POST",
      url: "http://127.0.0.1:5000/v1/nakama-cloud/sign-in",
    });
    expect(
      calls.filter(
        (call) => call.method === "GET" && call.url.endsWith("/v1/nakama-cloud")
      )
    ).toHaveLength(2);
  });

  test("Cancel stops the wait and closes the sign-in", async () => {
    const { calls, signIn } = await setup();
    const controller = new AbortController();

    const waiting = signIn({
      cloudUrl: "https://a.test",
      openExternal: async () => controller.abort(),
      signal: controller.signal,
      wait: 1,
    });

    await expect(waiting).rejects.toThrow("first-run-cancelled");
    expect(calls.at(-1)).toMatchObject({
      method: "DELETE",
      url: "http://127.0.0.1:5000/v1/nakama-cloud",
    });
  });
});
