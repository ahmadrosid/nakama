import { describe, expect, test } from "bun:test";
import { createClientId, syncRowKeys } from "./client-id";

describe("createClientId", () => {
  test("returns a non-empty opaque string without crypto.randomUUID", () => {
    const id = createClientId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  test("returns unique values", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createClientId()));
    expect(ids.size).toBe(50);
  });
});

describe("syncRowKeys", () => {
  test("grows and shrinks the key list to match length", () => {
    const keys: string[] = [];
    syncRowKeys(keys, 3);
    expect(keys).toHaveLength(3);
    const first = keys[0];
    syncRowKeys(keys, 1);
    expect(keys).toEqual([first]);
  });
});
