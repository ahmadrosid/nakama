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
});
