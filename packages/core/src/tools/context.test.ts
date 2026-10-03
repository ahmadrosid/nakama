import { describe, expect, test } from "bun:test";
import { getProfileSoulDir } from "../soul/resolve";
import { buildToolExecutionContext, requireToolNotViewer } from "./context";

describe("requireToolNotViewer", () => {
  for (const orgRole of ["admin", "member"] as const) {
    test(`allows ${orgRole}`, () => {
      expect(() => requireToolNotViewer({ orgRole })).not.toThrow();
    });
  }

  for (const orgRole of ["viewer", undefined] as const) {
    test(`denies ${orgRole ?? "missing role"}`, () => {
      expect(() => requireToolNotViewer({ orgRole })).toThrow(
        expect.objectContaining({ status: 403 })
      );
    });
  }
});

describe("buildToolExecutionContext", () => {
  test("adds profile workspace root when org and profile are set", () => {
    const context = buildToolExecutionContext({
      orgId: "org_1",
      profileId: "profile_1",
    });

    expect(context.workspaceRoot).toBe(getProfileSoulDir("org_1", "profile_1"));
  });

  test("preserves an explicit workspace root", () => {
    const context = buildToolExecutionContext({
      orgId: "org_1",
      profileId: "profile_1",
      workspaceRoot: "/tmp/custom-workspace",
    });

    expect(context.workspaceRoot).toBe("/tmp/custom-workspace");
  });
});
