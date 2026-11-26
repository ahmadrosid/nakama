import { describe, expect, test } from "bun:test";
import { readRawString, readRecord, readString } from "./json-readers";

describe("json readers", () => {
  test("readRawString preserves empty, whitespace and base64 strings", () => {
    expect(readRawString("")).toBe("");
    expect(readRawString("   ")).toBe("   ");
    expect(readRawString("  padded  ")).toBe("  padded  ");
    expect(readRawString("aGVsbG8=")).toBe("aGVsbG8=");
    expect(readRawString(42)).toBeNull();
  });

  test("readString trims and rejects blank strings", () => {
    expect(readString("  padded  ")).toBe("padded");
    expect(readString("   ")).toBeNull();
    expect(readString("")).toBeNull();
    expect(readString(42)).toBeNull();
  });

  test("readRecord separates objects from arrays and primitives", () => {
    expect(readRecord({ value: 1 })).toEqual({ value: 1 });
    expect(readRecord([1, 2])).toBeNull();
    expect(readRecord(null)).toBeNull();
    expect(readRecord("text")).toBeNull();
  });
});
