import { expect, test } from "bun:test";
import { normalizeUrl, SupermemoryClient } from "./client";

test("connection endpoints reject token leaks and insecure public HTTP", () => {
  for (const url of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com?q=1",
    "https://example.com#x",
  ]) {
    expect(() => normalizeUrl(url)).toThrow();
  }
  expect(normalizeUrl("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
  expect(normalizeUrl("http://192.168.1.2:3000")).toBe(
    "http://192.168.1.2:3000"
  );
});

test("HTTP errors never return upstream bodies or credentials", async () => {
  const client = new SupermemoryClient(
    { token: "private-token", url: "http://localhost:3000" },
    async () => new Response("private-token", { status: 401 })
  );
  await expect(client.request("POST", "/v4/search", {})).rejects.toThrow(
    "authentication"
  );
});

test("rejects redirects, invalid JSON and oversized responses", async () => {
  for (const response of [
    new Response(null, { status: 302 }),
    new Response("not-json"),
    new Response("x".repeat(2_100_000)),
  ]) {
    const client = new SupermemoryClient(
      { token: "secret", url: "http://localhost:3000" },
      async () => response
    );
    await expect(client.request("POST", "/v4/search", {})).rejects.toThrow();
  }
});

test("aborts a stalled request within the configured timeout", async () => {
  const client = new SupermemoryClient(
    { token: "secret", url: "http://localhost:3000" },
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener(
          "abort",
          () => reject(init.signal!.reason),
          { once: true }
        );
      })
  );
  await expect(client.request("POST", "/v4/search", {})).rejects.toThrow(
    "timed out"
  );
}, 15_000);

test("whole-document reads can use an explicitly larger bounded response budget", async () => {
  const content = "a".repeat(2_200_000);
  const client = new SupermemoryClient(
    { token: "secret", url: "http://localhost:3000" },
    async () => Response.json({ content }),
    3_000_000
  );
  expect((await client.request("GET", "/v3/documents/document")).content).toBe(
    content
  );
  const limited = new SupermemoryClient(
    { token: "secret", url: "http://localhost:3000" },
    async () => Response.json({ content }),
    2_000_000
  );
  await expect(
    limited.request("GET", "/v3/documents/document")
  ).rejects.toThrow();
});
