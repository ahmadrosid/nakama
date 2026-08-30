import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { formatCliDisplayPath, isCliVerbose } from "./display-path";

describe("isCliVerbose", () => {
  test("detects --verbose", () => {
    expect(isCliVerbose(["--org", "acme", "--verbose"])).toBe(true);
    expect(isCliVerbose(["--profile", "default"])).toBe(false);
  });
});

describe("formatCliDisplayPath", () => {
  const home = homedir();
  const soulDir = join(
    home,
    ".nakama",
    "orgs",
    "org_052abc599f8446afb7fde999214c776c",
    "profiles",
    "linus-torvalds"
  );
  const configPath = join(home, ".nakama", "config.ini");

  test("masks home, org id, and profile id by default", () => {
    expect(formatCliDisplayPath(soulDir)).toBe(
      "~/.nakama/orgs/<org>/profiles/<profile>"
    );
  });

  test("masks config path home without inventing org segments", () => {
    expect(formatCliDisplayPath(configPath)).toBe("~/.nakama/config.ini");
  });

  test("returns the absolute path when verbose", () => {
    expect(formatCliDisplayPath(soulDir, true)).toBe(soulDir);
    expect(formatCliDisplayPath(configPath, true)).toBe(configPath);
  });

  test("masks foreign home prefixes", () => {
    expect(
      formatCliDisplayPath("/Users/other/.nakama/orgs/org_abc/profiles/bot")
    ).toBe("~/.nakama/orgs/<org>/profiles/<profile>");
  });
});
