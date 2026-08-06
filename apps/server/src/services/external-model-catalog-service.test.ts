import { afterEach, describe, expect, test } from "bun:test";
import {
  getExternalModelCatalog,
  isExternalModelCatalogId,
} from "./external-model-catalog-service";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("isExternalModelCatalogId", () => {
  test("accepts supported catalog ids", () => {
    expect(isExternalModelCatalogId("models-dev")).toBe(true);
    expect(isExternalModelCatalogId("openrouter")).toBe(true);
    expect(isExternalModelCatalogId("cerebras")).toBe(true);
  });

  test("rejects unknown catalog ids", () => {
    expect(isExternalModelCatalogId("unknown")).toBe(false);
  });
});

describe("getExternalModelCatalog", () => {
  test("fetches and returns catalog payload", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ openai: { models: {} } }), { status: 200 });

    await expect(getExternalModelCatalog("models-dev")).resolves.toEqual({
      openai: { models: {} },
    });
  });

  test("throws when upstream request fails", async () => {
    globalThis.fetch = async () => new Response("nope", { status: 502 });

    await expect(getExternalModelCatalog("openrouter")).rejects.toThrow(
      "Failed to fetch model catalog (502)",
    );
  });
});
