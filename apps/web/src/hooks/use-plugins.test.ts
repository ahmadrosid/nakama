import { describe, expect, test } from "bun:test";
import type { OrgPluginDetail } from "@nakama/core";
import {
  groupAssignableTools,
  nextPluginVersions,
  pluginRowActions,
} from "./use-plugins";

function plugin(overrides: Partial<OrgPluginDetail>): OrgPluginDetail {
  // SAFETY: The test controls this fixture or mock and asserts the resulting behavior.
  return {
    availableVersions: ["1.0.0"],
    installed: true,
    lifecycleState: "enabled",
    selectedVersion: "1.0.0",
    ...overrides,
  } as OrgPluginDetail;
}

describe("plugin updates", () => {
  test("only newer releases are offered, newest first", () => {
    expect(
      nextPluginVersions(
        plugin({
          availableVersions: [
            "1.0.0",
            "1.2.0",
            "1.10.0",
            "0.9.0",
            "1.2.0-rc.1",
          ],
          selectedVersion: "1.2.0-rc.1",
        })
      )
    ).toEqual(["1.10.0", "1.2.0"]);
  });

  test("a plugin on its newest release offers no Update", () => {
    for (const lifecycleState of ["enabled", "disabled"] as const) {
      const actions = pluginRowActions(
        plugin({
          availableVersions: ["1.0.0", "1.0.1"],
          lifecycleState,
          selectedVersion: "1.0.1",
        })
      );

      expect(actions.update).toBe(false);
    }
  });
});

describe("assignable tool groups", () => {
  const tool = (
    id: string,
    handlerType: string,
    pluginId: string | null = null
  ) => ({ description: "", handlerType, id, name: id, pluginId });

  test("the browser tools and each plugin's actions form one group each", () => {
    const groups = groupAssignableTools([
      tool("bash", "bash"),
      tool("browser_navigate", "browser"),
      tool("browser_read", "browser"),
      tool("crm_create", "plugin", "crm"),
      tool("crm_list", "plugin", "crm"),
    ]);

    expect(
      groups.map((group) => [
        group.label,
        group.tools.map((member) => member.id),
        group.unit,
      ])
    ).toEqual([
      ["bash", ["bash"], null],
      ["Cloud browser", ["browser_navigate", "browser_read"], "tools"],
      ["crm", ["crm_create", "crm_list"], "actions"],
    ]);
  });
});
