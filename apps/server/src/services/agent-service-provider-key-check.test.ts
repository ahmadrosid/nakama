import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { asTestFetch } from "../providers/test-helpers";
import { AgentService } from "./agent-service";
import { ManagedSecrets } from "./managed-secrets";

describe("API key check on save", () => {
  const LONG_KEY = `sk-${"a".repeat(40)}`;

  async function withDeepSeekProvider(
    respond: () => Promise<Response>,
    run: (service: AgentService, providerId: string) => Promise<void>,
    request: Parameters<AgentService["createProvider"]>[0] = {
      type: "deepseek",
    }
  ) {
    const configDir = await mkdtemp(path.join(tmpdir(), "nakama-key-check-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    using _fetchMock = spyOn(globalThis, "fetch").mockImplementation(
      asTestFetch(respond)
    );

    try {
      const db = createInMemoryDatabaseAdapter();

      const service = new AgentService(
        null,
        null,
        db,
        undefined,
        new ManagedSecrets(db, Buffer.alloc(32, 1).toString("base64"))
      );

      const created = await service.createProvider(request);
      await run(service, created.provider.id);
    } finally {
      delete process.env.NAKAMA_CONFIG_DIR;
      await rm(configDir, { force: true, recursive: true });
    }
  }

  test("does not save a key the provider refuses", async () => {
    await withDeepSeekProvider(
      async () => new Response("bad key", { status: 401 }),
      async (service, providerId) => {
        await expect(
          service.setProviderSecret(providerId, LONG_KEY)
        ).rejects.toMatchObject({ status: 400 });

        const listed = await service.listProviders();
        expect(
          listed.providers.find((provider) => provider.id === providerId)
            ?.hasApiKey
        ).toBe(false);
      }
    );
  });

  test("a check reports a saved key the provider now refuses", async () => {
    let calls = 0;

    await withDeepSeekProvider(
      async () => {
        calls += 1;

        // The save check passes; the later check is refused.
        return calls === 1
          ? Response.json({ data: [] })
          : new Response("revoked", { status: 401 });
      },
      async (service, providerId) => {
        await service.setProviderSecret(providerId, LONG_KEY);

        expect(await service.checkProvider(providerId)).toEqual({
          status: "rejected",
        });
      }
    );
  });

  test("a check without a saved key does not call the provider", async () => {
    let calls = 0;

    await withDeepSeekProvider(
      async () => {
        calls += 1;

        return Response.json({ data: [] });
      },
      async (service, providerId) => {
        expect(await service.checkProvider(providerId)).toEqual({
          status: "unchecked",
        });
        expect(calls).toBe(0);
      }
    );
  });

  test("a check finds a local endpoint without a key that is down", async () => {
    await withDeepSeekProvider(
      () => Promise.reject(new Error("connect ECONNREFUSED")),
      async (service, providerId) => {
        expect(await service.checkProvider(providerId)).toEqual({
          status: "unreachable",
        });
      },
      {
        baseUrl: "http://127.0.0.1:9/v1",
        customModels: [{ id: "local-model" }],
        label: "verify-bs local",
        type: "openai_compatible",
      }
    );
  });

  test("a check tells a keyless endpoint that wants a key apart", async () => {
    await withDeepSeekProvider(
      async () => new Response("unauthorized", { status: 401 }),
      async (service, providerId) => {
        expect(await service.checkProvider(providerId)).toEqual({
          status: "needs-key",
        });
      },
      {
        baseUrl: "http://127.0.0.1:9/v1",
        customModels: [{ id: "local-model" }],
        label: "verify-bs keyed",
        type: "openai_compatible",
      }
    );
  });

  test("another provider can become the default", async () => {
    await withDeepSeekProvider(
      async () => Response.json({ data: [] }),
      async (service, firstId) => {
        const second = await service.createProvider({ type: "mistral" });

        await service.setDefaultProvider(second.provider.id);
        expect((await service.listProviders()).defaultProviderId).toBe(
          second.provider.id
        );
        expect(firstId).not.toBe(second.provider.id);
      }
    );
  });

  test("saves a key the provider accepts", async () => {
    await withDeepSeekProvider(
      async () => Response.json({ data: [{ id: "deepseek-chat" }] }),
      async (service, providerId) => {
        const result = await service.setProviderSecret(providerId, LONG_KEY);
        expect(result.provider.hasApiKey).toBe(true);
      }
    );
  });

  test("saves the key when the provider cannot be reached", async () => {
    await withDeepSeekProvider(
      async () => {
        throw new TypeError("Unable to connect.");
      },
      async (service, providerId) => {
        const result = await service.setProviderSecret(providerId, LONG_KEY);
        expect(result.provider.hasApiKey).toBe(true);
      }
    );
  });
});
