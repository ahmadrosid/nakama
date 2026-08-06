import { describe, expect, test } from "bun:test";
import { resolveSkillWriteApprovalRequired } from "./write-approval";

describe("resolveSkillWriteApprovalRequired", () => {
  test("defaults to false when org and profile unset", () => {
    expect(resolveSkillWriteApprovalRequired({})).toBe(false);
  });

  test("org true enables gate when profile inherits", () => {
    expect(
      resolveSkillWriteApprovalRequired({
        orgSkillsWriteApproval: true,
        profileSkillsWriteApproval: null,
      }),
    ).toBe(true);
  });

  test("profile false overrides org true (AE7)", () => {
    expect(
      resolveSkillWriteApprovalRequired({
        orgSkillsWriteApproval: true,
        profileSkillsWriteApproval: false,
      }),
    ).toBe(false);
  });

  test("profile true forces gate on when org false", () => {
    expect(
      resolveSkillWriteApprovalRequired({
        orgSkillsWriteApproval: false,
        profileSkillsWriteApproval: true,
      }),
    ).toBe(true);
  });
});
