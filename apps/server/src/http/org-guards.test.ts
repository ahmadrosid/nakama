import { describe, expect, test } from "bun:test";
import { NakamaApiError } from "@nakama/core";
import {
  requireNotViewer,
  requireOrgAdmin,
  requirePlatformAdmin,
} from "./org-guards";
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
  test("requireOrgAdmin allows org admins", () => {
    expect(() => requireOrgAdmin(auth("admin"))).not.toThrow();
  });

  test("requireOrgAdmin rejects members and viewers", () => {
    expect(() => requireOrgAdmin(auth("member"))).toThrow(NakamaApiError);
    expect(() => requireOrgAdmin(auth("viewer"))).toThrow(NakamaApiError);
    try {
      requireOrgAdmin(auth("member"));
    } catch (error) {
      expect(error).toMatchObject({ message: "Forbidden", status: 403 });
    }
  });

  test("requireNotViewer allows admins and members", () => {
    expect(() => requireNotViewer(auth("admin"))).not.toThrow();
    expect(() => requireNotViewer(auth("member"))).not.toThrow();
  });

  test("requireNotViewer rejects viewers and users without membership", () => {
    expect(() => requireNotViewer(auth("viewer"))).toThrow(NakamaApiError);
    expect(() => requireNotViewer(auth(undefined))).toThrow(NakamaApiError);
  });

  test("requirePlatformAdmin allows platform admins", () => {
    expect(() =>
      requirePlatformAdmin({
        ...auth("admin"),
        isPlatformAdmin: true,
      })
    ).not.toThrow();
  });
});
