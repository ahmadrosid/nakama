import { describe, expect, test } from "bun:test";
import { resolveSystemTab, visibleSystemTabs } from "./system-page.shared";

describe("SystemPage tab access", () => {
  test("shows data portability only to platform admins", () => {
    expect(visibleSystemTabs(true).map((tab) => tab.id)).toEqual(["tools", "mcp", "data"]);
    expect(visibleSystemTabs(false).map((tab) => tab.id)).toEqual(["tools"]);
  });

  test("forces non-platform users back to tools tab", () => {
    expect(resolveSystemTab("data", true)).toBe("data");
    expect(resolveSystemTab("data", false)).toBe("tools");
    expect(resolveSystemTab("unknown", true)).toBe("tools");
  });
});
