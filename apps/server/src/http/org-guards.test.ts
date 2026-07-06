import { describe, expect, test } from "bun:test";
import { NakamaApiError } from "@nakama/core";
import { requireNotViewer, requireOrgAdmin, requirePlatformAdmin } from "./org-guards";
import type { RequestAuthContext } from "./shared";

function auth(orgRole: RequestAuthContext["orgRole"]): RequestAuthContext {
  return {
    mode: "browser-session",
    user: { id: "user_1", email: "user@example.com" },
    isPlatformAdmin: false,
    activeOrgId: "org_1",
    orgRole,
  };
}

describe("org guards", () => {
  test("requireOrgAdmin allows org admins", () => {
    expect(() => requireOrgAdmin(auth("admin"))).not.toThrow();
  });

  test("requireOrgAdmin rejects members and viewers", () => {
    expect(() => requireOrgAdmin(auth("member"))).toThrow(NakamaApiError);
    expect(() => requireOrgAdmin(auth("viewer"))).toThrow(NakamaApiError);
    try {
      requireOrgAdmin(auth("member"));
    } catch (error) {
      expect(error).toMatchObject({ status: 403, message: "Forbidden" });
    }
  });

  test("requireNotViewer allows admins and members", () => {
    expect(() => requireNotViewer(auth("admin"))).not.toThrow();
    expect(() => requireNotViewer(auth("member"))).not.toThrow();
  });

  test("requireNotViewer rejects viewers", () => {
    try {
      requireNotViewer(auth("viewer"));
    } catch (error) {
      expect(error).toMatchObject({ status: 403, message: "Forbidden" });
    }
  });

  test("requirePlatformAdmin allows platform admins", () => {
    expect(() =>
      requirePlatformAdmin({
        ...auth("admin"),
        isPlatformAdmin: true,
      }),
    ).not.toThrow();
  });

  test("requirePlatformAdmin rejects non-platform users", () => {
    try {
      requirePlatformAdmin(auth("admin"));
    } catch (error) {
      expect(error).toMatchObject({ status: 403, message: "Forbidden" });
    }
  });
});
