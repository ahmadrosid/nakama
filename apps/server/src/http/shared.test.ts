import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseOptionalQueryEnum, readJson, readOptionalJson } from "./shared";

const URL = "http://localhost:4310/test";

describe("readOptionalJson", () => {
  const schema = z.object({ enabled: z.boolean() });

  test("returns the fallback for an empty optional body", async () => {
    const request = new Request(URL, { body: " \n", method: "POST" });

    await expect(
      readOptionalJson(request, { enabled: false }, schema)
    ).resolves.toEqual({ enabled: false });
  });

  test("rejects malformed non-empty JSON", async () => {
    const request = new Request(URL, { body: "{", method: "POST" });

    await expect(
      readOptionalJson(request, { enabled: false }, schema)
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  test("rejects JSON that does not match the schema", async () => {
    const request = new Request(URL, {
      body: JSON.stringify({ enabled: "yes" }),
      method: "POST",
    });

    await expect(
      readOptionalJson(request, { enabled: false }, schema)
    ).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("readJson", () => {
  const schema = z.object({ enabled: z.boolean() });

  test("returns schema-validated JSON", async () => {
    const request = new Request(URL, {
      body: JSON.stringify({ enabled: true }),
      method: "POST",
    });

    await expect(readJson(request, schema)).resolves.toEqual({ enabled: true });
  });

  test("rejects a wrong-typed body", async () => {
    const request = new Request(URL, {
      body: JSON.stringify({ enabled: "yes" }),
      method: "POST",
    });

    await expect(readJson(request, schema)).rejects.toMatchObject({
      status: 400,
    });
  });

  test("preserves malformed JSON rejection", async () => {
    const request = new Request(URL, { body: "{", method: "POST" });

    await expect(readJson(request, schema)).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("parseOptionalQueryEnum", () => {
  test("accepts known and absent values", () => {
    expect(parseOptionalQueryEnum("pending", ["pending", "applied"])).toBe(
      "pending"
    );
    expect(parseOptionalQueryEnum(undefined, ["pending", "applied"])).toBe(
      undefined
    );
  });

  test("rejects unknown values", () => {
    expect(() =>
      parseOptionalQueryEnum("unknown", ["pending", "applied"])
    ).toThrow();
  });
});
