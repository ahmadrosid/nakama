import { describe, expect, test } from "bun:test";
import { NakamaApiError } from "@nakama/core";
import { requireOrgAdmin, requireOrgMember } from "./org-guards";
import type { RequestAuthContext } from "./shared";

function auth(orgRole: RequestAuthContext["orgRole"]): RequestAuthContext {
  return {
    activeOrgId: "org_1",
    isPlatformAdmin: false,
    mode: "browser-session",
    orgRole,
    user: { email: "user@example.com", id: "user_1" },
  };
}

describe("org guards", () => {
  test("requireOrgAdmin rejects members and users without membership", () => {
    expect(() => requireOrgAdmin(auth("member"))).toThrow(NakamaApiError);
    expect(() => requireOrgAdmin(auth(undefined))).toThrow(NakamaApiError);

    try {
      requireOrgAdmin(auth("member"));
    } catch (error) {
      expect(error).toMatchObject({ message: "Forbidden", status: 403 });
    }
  });

  test("requireOrgMember rejects users without membership", () => {
    expect(() => requireOrgMember(auth(undefined))).toThrow(NakamaApiError);
  });
});
