import { describe, expect, test } from "bun:test";
import { resolveSystemTab, visibleSystemTabs } from "./system-page.shared";

describe("SystemPage tab access", () => {
  test("shows usage to system users and MCP only to platform admins", () => {
    expect(visibleSystemTabs(true).map((tab) => tab.id)).toEqual([
      "tools",
      "usage",
      "mcp",
    ]);
    expect(visibleSystemTabs(false).map((tab) => tab.id)).toEqual([
      "tools",
      "usage",
    ]);
  });

  test("resolves usage for all system users and forces non-platform users off admin tabs", () => {
    expect(resolveSystemTab("usage", true)).toBe("usage");
    expect(resolveSystemTab("usage", false)).toBe("usage");
    expect(resolveSystemTab("organization", true)).toBe("tools");
    expect(resolveSystemTab("organization", false)).toBe("tools");
    expect(resolveSystemTab("mcp", true)).toBe("mcp");
    expect(resolveSystemTab("mcp", false)).toBe("tools");
    expect(resolveSystemTab("data", true)).toBe("tools");
    expect(resolveSystemTab("data", false)).toBe("tools");
    expect(resolveSystemTab("unknown", true)).toBe("tools");
  });
});
