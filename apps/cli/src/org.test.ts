import { describe, expect, test } from "bun:test";
import { InvalidOrgArgError, parseCliOrgArgs } from "./org";

describe("parseCliOrgArgs", () => {
  test("parses --org flag", () => {
    expect(parseCliOrgArgs(["launch", "claude", "--org", "org_abc"])).toEqual({
      orgId: "org_abc",
    });
    expect(parseCliOrgArgs(["--org=org_xyz"])).toEqual({ orgId: "org_xyz" });
  });

  test("parses org slugs", () => {
    expect(parseCliOrgArgs(["--org", "acme-co"])).toEqual({
      orgId: "acme-co",
    });
  });

  test("rejects missing --org value", () => {
    expect(() => parseCliOrgArgs(["--org"])).toThrow(InvalidOrgArgError);
    expect(() => parseCliOrgArgs(["--org", "--theme", "dark"])).toThrow(
      InvalidOrgArgError
    );
  });

  test("rejects invalid --org shape", () => {
    expect(() => parseCliOrgArgs(["--org", "../etc"])).toThrow(
      InvalidOrgArgError
    );
    expect(() => parseCliOrgArgs(["--org=org_abc/../x"])).toThrow(
      InvalidOrgArgError
    );
    expect(() => parseCliOrgArgs([`--org=${"a".repeat(200)}`])).toThrow(
      InvalidOrgArgError
    );
  });
});
