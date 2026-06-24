import { describe, expect, test } from "bun:test";
import { languageFromSourcePath } from "./ToolSourceCodeBlock";

describe("languageFromSourcePath", () => {
  test("maps common tool file extensions", () => {
    expect(languageFromSourcePath("~/.tinyclaw/tools/mp4-to-mp3.js")).toBe("javascript");
    expect(languageFromSourcePath("packages/core/src/tools/builtin.ts")).toBe("typescript");
    expect(languageFromSourcePath("config.json")).toBe("json");
  });
});
