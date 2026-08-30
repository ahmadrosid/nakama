import { describe, expect, test } from "bun:test";
import { syncRowKeys } from "./client-id";

describe("syncRowKeys", () => {
  test("grows and shrinks the key list to match length", () => {
    const keys: string[] = [];
    syncRowKeys(keys, 3);
    expect(keys).toHaveLength(3);
    const first = keys[0];
    syncRowKeys(keys, 1);
    expect(keys).toEqual([first]);
  });

  test("middle splice keeps sibling keys stable after remove-and-readd", () => {
    const keys: string[] = [];
    syncRowKeys(keys, 3);
    const [first, , third] = keys;

    keys.splice(1, 1);
    syncRowKeys(keys, 2);
    expect(keys).toEqual([first, third]);

    syncRowKeys(keys, 3);
    expect(keys[0]).toBe(first);
    expect(keys[1]).toBe(third);
    expect(keys[2]).not.toBe(first);
    expect(keys[2]).not.toBe(third);
  });
});
