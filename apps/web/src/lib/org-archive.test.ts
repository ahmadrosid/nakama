import { describe, expect, test } from "bun:test";
import { canArchiveOrganization, nextOrgIdAfterArchive } from "./org-archive";

describe("org archive helpers", () => {
  test("only platform admins can archive", () => {
    expect(canArchiveOrganization(true)).toBe(true);
    expect(canArchiveOrganization(false)).toBe(false);
  });

  test("picks a remaining org after archive", () => {
    expect(
      nextOrgIdAfterArchive([{ id: "org_a" }, { id: "org_b" }], "org_a")
    ).toBe("org_b");
  });

  test("returns null when no remaining org exists", () => {
    expect(nextOrgIdAfterArchive([{ id: "org_a" }], "org_a")).toBeNull();
  });
});
