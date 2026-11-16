import { describe, expect, spyOn, test } from "bun:test";
import type { LookupAddress, LookupAllOptions } from "node:dns";
import * as dnsModule from "node:dns/promises";
import { asTestFetch } from "../providers/test-helpers";
import { McpClientManager } from "./mcp-client-manager";
import { assertNotLinkLocal, fetchMcpRemote } from "./mcp-fetch";

const dns: {
  lookup(hostname: string, options: LookupAllOptions): Promise<LookupAddress[]>;
} = dnsModule;

describe("MCP remote fetch", () => {
  test.each(["init", "request", "deadline"] as const)(
    "stops waiting for DNS with the %s signal and ignores late results",
    async (source) => {
      const lookup = Promise.withResolvers<LookupAddress[]>();

      using dnsSpy = spyOn(dns, "lookup").mockImplementation(
        () => lookup.promise
      );

      using fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
        asTestFetch(async () => new Response("unexpected"))
      );

      const controller = new AbortController();
      const reason = new Error("cancelled DNS");
      const realTimeout = AbortSignal.timeout;

      using deadlineSpy = spyOn(AbortSignal, "timeout").mockImplementation(
        (ms) => (source === "deadline" ? controller.signal : realTimeout(ms))
      );

      const url = "https://pending.invalid/mcp";
      let outcome = "pending";
      let failure: Error | undefined;

      const pending = (
        source === "request"
          ? fetchMcpRemote(new Request(url, { signal: controller.signal }))
          : fetchMcpRemote(
              url,
              source === "deadline" ? undefined : { signal: controller.signal }
            )
      ).then(
        () => {
          outcome = "fulfilled";
        },
        (error: Error) => {
          outcome = "rejected";
          failure = error;
        }
      );

      try {
        controller.abort(reason);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(outcome).toBe("rejected");
        expect(failure).toBe(reason);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(dnsSpy).toHaveBeenCalledTimes(1);
        expect(deadlineSpy).toHaveBeenCalledWith(5000);
      } finally {
        lookup.resolve([{ address: "127.0.0.1", family: 4 }]);
        await pending;
      }

      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );

  test.each([false, true])(
    "DNS results with a link-local address: %s",
    async (linkLocal) => {
      using dnsSpy = spyOn(dns, "lookup").mockImplementation(async () => [
        { address: "127.0.0.1", family: 4 },
        {
          address: linkLocal ? "fe80::1" : "10.0.0.5",
          family: linkLocal ? 6 : 4,
        },
      ]);

      using fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
        asTestFetch(async () => new Response("ok"))
      );

      const pending = fetchMcpRemote("https://resolved.invalid/mcp");

      if (linkLocal) {
        await expect(pending).rejects.toThrow();
        expect(fetchSpy).not.toHaveBeenCalled();
      } else {
        expect((await pending).status).toBe(200);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      }

      expect(dnsSpy).toHaveBeenCalledTimes(1);
    }
  );

  test("refuses link-local addresses, including the cloud metadata host", async () => {
    for (const host of [
      "169.254.169.254",
      "[fe80::1]",
      "::ffff:169.254.169.254",
    ]) {
      await expect(assertNotLinkLocal(host)).rejects.toThrow("link-local");
    }
  });

  test("keeps loopback and private hosts reachable", async () => {
    for (const host of ["127.0.0.1", "10.0.0.5", "192.168.1.20", "[::1]"]) {
      await expect(assertNotLinkLocal(host)).resolves.toBeUndefined();
    }
  });

  test("an HTTP MCP server on the metadata address is refused before any request", async () => {
    const manager = new McpClientManager();

    await expect(
      manager.ensureConnected(
        {
          cachedTools: [],
          config: { url: "http://169.254.169.254/mcp" },
          createdAt: "",
          enabled: true,
          id: "metadata",
          lastError: null,
          name: "metadata",
          status: "disconnected",
          transport: "http",
          updatedAt: "",
        },
        "org_1",
        "profile_1"
      )
    ).rejects.toThrow("link-local");

    await manager.disconnectAll();
  });
});
