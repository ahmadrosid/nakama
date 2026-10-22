import { describe, expect, test } from "bun:test";
import { InvalidThemeArgError, parseThemeArg } from "./theme-arg";

describe("parseThemeArg", () => {
  test("rejects unknown --theme values", () => {
    expect(() => parseThemeArg(["--theme", "sepia"])).toThrow(
      InvalidThemeArgError
    );
    expect(() => parseThemeArg(["--theme=neon"])).toThrow(InvalidThemeArgError);
  });

  test("rejects missing --theme value", () => {
    expect(() => parseThemeArg(["--theme"])).toThrow(InvalidThemeArgError);
  });
});
