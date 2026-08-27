import { describe, expect, test } from "bun:test";
import { InvalidThemeArgError, parseThemeArg } from "./theme-arg";

describe("parseThemeArg", () => {
  test("parses --theme light/dark", () => {
    expect(parseThemeArg(["--theme", "light"])).toBe("light");
    expect(parseThemeArg(["chat", "--theme", "dark"])).toBe("dark");
  });

  test("parses --theme=light/dark", () => {
    expect(parseThemeArg(["--theme=light"])).toBe("light");
    expect(parseThemeArg(["--theme=dark"])).toBe("dark");
  });

  test("returns null when flag is absent", () => {
    expect(parseThemeArg(["chat"])).toBeNull();
    expect(parseThemeArg([])).toBeNull();
  });

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
