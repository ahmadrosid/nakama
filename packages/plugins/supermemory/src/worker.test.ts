import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installServer, providerEnvironment } from "./worker";

test("worker maps API-key and local providers without forwarding subscription credentials", () => {
  expect(
    providerEnvironment({
      apiKey: "test-key",
      model: "test-model",
      type: "openai",
    })
  ).toEqual({
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    OPENAI_MODEL: "test-model",
  });
  expect(providerEnvironment({ model: "local", type: "ollama" })).toMatchObject(
    {
      OPENAI_API_KEY: "ollama",
      OPENAI_BASE_URL: "http://localhost:11434/v1",
    }
  );
  expect(
    providerEnvironment({ apiKey: "test-key", type: "anthropic" })
  ).toEqual({ ANTHROPIC_API_KEY: "test-key" });
  expect(() =>
    providerEnvironment({
      apiKey: "subscription-secret",
      baseUrl: "https://example.com",
      type: "chatgpt",
    })
  ).toThrow();
  expect(() => providerEnvironment({ type: "openai" })).toThrow();
  expect(
    providerEnvironment({ baseUrl: "http://localhost:11434/", type: "ollama" })
      .OPENAI_BASE_URL
  ).toBe("http://localhost:11434/v1");
});

test("the worker rejects a binary whose checksum does not match the pinned release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "supermemory-download-"));
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("not-a-server")) as unknown as typeof fetch;
  try {
    await expect(installServer(directory)).rejects.toThrow("checksum mismatch");
    expect(
      await Bun.file(join(directory, "supermemory-server-0.0.8")).exists()
    ).toBe(false);
  } finally {
    globalThis.fetch = original;
    await rm(directory, { force: true, recursive: true });
  }
});

test("worker refuses inherited chat credentials without explicit extraction settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "supermemory-provider-"));
  try {
    await Bun.write(
      join(directory, "llm.json"),
      JSON.stringify({
        apiKey: "inherited-secret",
        model: "big-pickle",
        type: "openai_compatible",
      })
    );
    const child = Bun.spawn(
      [process.execPath, new URL("./worker.ts", import.meta.url).pathname],
      {
        env: {
          ...process.env,
          NAKAMA_PLUGIN_DATA_DIR: directory,
          NAKAMA_WORKER_DATA_DIR: directory,
        },
        stderr: "pipe",
        stdout: "pipe",
      }
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).not.toBe(0);
    expect(await Bun.file(join(directory, "status.json")).json()).toMatchObject(
      { state: "error" }
    );
    expect(await Bun.file(join(directory, "connection.json")).exists()).toBe(
      false
    );
    expect(stdout + stderr).not.toContain("inherited-secret");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("extraction proxy translates legacy parameters and restricts access", async () => {
  const { startExtractionProxy } = await import("./worker");
  const requests: Record<string, unknown>[] = [];
  const upstream = Bun.serve({
    async fetch(request) {
      expect(request.headers.get("Authorization")).toBe("Bearer real-key");
      requests.push(await request.json());
      return Response.json({ choices: [{ message: { content: "ok" } }] });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  const proxy = startExtractionProxy({
    apiKey: "real-key",
    baseUrl: `http://127.0.0.1:${upstream.port}/v1`,
    model: "gpt-5.6-luna",
    revision: "test",
  });
  try {
    const url = proxy.baseUrl + "/chat/completions";
    expect((await fetch(url, { body: "{}", method: "POST" })).status).toBe(401);
    const headers = {
      Authorization: `Bearer ${proxy.token}`,
      "Content-Type": "application/json",
    };
    expect(
      (
        await fetch(proxy.baseUrl + "/other", {
          body: "{}",
          headers,
          method: "POST",
        })
      ).status
    ).toBe(404);
    const response = await fetch(url, {
      body: JSON.stringify({
        max_tokens: 100,
        messages: [],
        model: "other",
        serviceTier: "auto",
      }),
      headers,
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(requests).toEqual([
      {
        max_completion_tokens: 100,
        messages: [],
        model: "gpt-5.6-luna",
        service_tier: "auto",
      },
    ]);
    await fetch(url, {
      body: JSON.stringify({
        max_completion_tokens: 200,
        max_tokens: 1,
        service_tier: "default",
        serviceTier: "auto",
      }),
      headers,
      method: "POST",
    });
    expect(requests[1]).toEqual({
      max_completion_tokens: 200,
      model: "gpt-5.6-luna",
      service_tier: "default",
    });
    await fetch(url, {
      body: JSON.stringify({
        messages: [{ content: "Extract facts", role: "user" }],
        reasoning_effort: "medium",
        response_format: { type: "json_object" },
        tools: [{ type: "function" }],
      }),
      headers,
      method: "POST",
    });
    expect(requests[2]).toMatchObject({
      messages: [
        { content: "Return valid JSON.", role: "system" },
        { content: "Extract facts", role: "user" },
      ],
      reasoning_effort: "none",
    });
  } finally {
    await proxy.server.stop(true);
    await upstream.stop(true);
  }
});
