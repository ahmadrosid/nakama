import { describe, expect, test } from "bun:test";
import { agentWorkPanelClassName } from "@/pages/automations/automations-page.shared";

describe("agentWorkPanelClassName", () => {
  test("keeps agent work tabpanels in the flex height chain so run history can scroll", () => {
    const classes = agentWorkPanelClassName.split(/\s+/);

    expect(classes).toContain("flex");
    expect(classes).toContain("flex-col");
    expect(classes).toContain("min-h-0");
    expect(classes).toContain("flex-1");
    expect(classes).toContain("overflow-hidden");
  });
});
