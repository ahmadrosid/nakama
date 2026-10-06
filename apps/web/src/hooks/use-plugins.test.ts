import { describe, expect, test } from "bun:test";
import type { OrgPluginDetail } from "@nakama/core";
import { nextPluginVersions, pluginRowActions } from "./use-plugins";

function plugin(overrides: Partial<OrgPluginDetail>): OrgPluginDetail {
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

  test("an enabled plugin offers Update when a newer release is approved", () => {
    const actions = pluginRowActions(
      plugin({ availableVersions: ["1.0.0", "1.0.1"] })
    );
    expect(actions.update).toBe(true);
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
