import { describe, expect, test } from "bun:test";
import { parseCliOrgArgs } from "./org";
import { parseLaunchArgs } from "./launch";

describe("parseCliOrgArgs", () => {
  test("parses --org flag", () => {
    expect(parseCliOrgArgs(["launch", "claude", "--org", "org_abc"])).toEqual({
      orgId: "org_abc",
    });
    expect(parseCliOrgArgs(["--org=org_xyz"])).toEqual({ orgId: "org_xyz" });
  });
});

describe("parseLaunchArgs org flag", () => {
  test("parses org alongside profile", () => {
    expect(
      parseLaunchArgs(["launch", "claude", "--org", "org_abc", "--profile", "super_bot"]),
    ).toEqual({
      backend: "claude",
      profileId: "super_bot",
      orgId: "org_abc",
      model: undefined,
      cwd: undefined,
      yes: false,
      persistSelection: false,
      passthroughArgs: [],
    });
  });
});
