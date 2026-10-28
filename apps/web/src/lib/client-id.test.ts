import { describe, expect, test } from "bun:test";
import { syncRowKeys } from "./client-id";

describe("syncRowKeys", () => {
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
