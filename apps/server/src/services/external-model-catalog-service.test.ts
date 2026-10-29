import { afterEach, describe, expect, test } from "bun:test";
import { asTestFetch } from "../providers/test-helpers";
import { getExternalModelCatalog } from "./external-model-catalog-service";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getExternalModelCatalog", () => {
  test("fetches and returns catalog payload", async () => {
    globalThis.fetch = asTestFetch(
      async () =>
        new Response(JSON.stringify({ openai: { models: {} } }), {
          status: 200,
        })
    );

    await expect(getExternalModelCatalog("models-dev")).resolves.toEqual({
      openai: { models: {} },
    });
  });

  test("throws when upstream request fails", async () => {
    globalThis.fetch = asTestFetch(
      async () => new Response("nope", { status: 502 })
    );

    await expect(getExternalModelCatalog("openrouter")).rejects.toThrow(
      "Failed to fetch model catalog (502)"
    );
  });
});
