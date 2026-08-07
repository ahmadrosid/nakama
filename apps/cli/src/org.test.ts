import { describe, expect, test } from "bun:test";
import { parseCliOrgArgs } from "./org";

describe("parseCliOrgArgs", () => {
  test("parses --org flag", () => {
    expect(parseCliOrgArgs(["launch", "claude", "--org", "org_abc"])).toEqual({
      orgId: "org_abc",
    });
    expect(parseCliOrgArgs(["--org=org_xyz"])).toEqual({ orgId: "org_xyz" });
  });
});
