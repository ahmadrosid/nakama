import { describe, expect, test } from "bun:test";
import { resolveSystemTab, visibleSystemTabs } from "./system-page.shared";

describe("SystemPage tab access", () => {
  test("shows status to all system users and MCP only to platform admins", () => {
    expect(visibleSystemTabs(true).map((tab) => tab.id)).toEqual([
      "status",
      "organization",
      "tools",
      "mcp",
    ]);
    expect(visibleSystemTabs(false).map((tab) => tab.id)).toEqual([
      "status",
      "organization",
      "tools",
    ]);
  });

  test("resolves status for all system users and forces non-platform users off admin tabs", () => {
    expect(resolveSystemTab("status", true)).toBe("status");
    expect(resolveSystemTab("status", false)).toBe("status");
    expect(resolveSystemTab("organization", true)).toBe("organization");
    expect(resolveSystemTab("organization", false)).toBe("organization");
    expect(resolveSystemTab("mcp", true)).toBe("mcp");
    expect(resolveSystemTab("mcp", false)).toBe("tools");
    expect(resolveSystemTab("data", true)).toBe("tools");
    expect(resolveSystemTab("data", false)).toBe("tools");
    expect(resolveSystemTab("unknown", true)).toBe("tools");
  });
});
