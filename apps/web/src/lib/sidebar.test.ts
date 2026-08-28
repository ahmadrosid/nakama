import { describe, expect, test } from "bun:test";
import { getInitialSystemNavCollapsed } from "./sidebar";

describe("sidebar system nav collapse", () => {
  test("defaults to expanded when storage is empty", () => {
    expect(getInitialSystemNavCollapsed()).toBe(false);
  });
});
