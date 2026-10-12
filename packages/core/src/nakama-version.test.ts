import { describe, expect, test } from "bun:test";
import { getNakamaVersion } from "./nakama-version";

describe("getNakamaVersion", () => {
  test("prefers NAKAMA_VERSION and strips a leading v", () => {
    expect(getNakamaVersion({ NAKAMA_VERSION: "v9.9.9" })).toBe("9.9.9");
  });
});
