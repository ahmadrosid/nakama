import { describe, expect, test } from "bun:test";
import { isPublicRouteRequest } from "./public-routes";

describe("isPublicRouteRequest", () => {
  test("allows Composio OAuth callback without auth", () => {
    expect(isPublicRouteRequest("GET", "/v1/composio/oauth/callback")).toBe(true);
  });

  test("still requires auth for other Composio routes", () => {
    expect(isPublicRouteRequest("GET", "/v1/composio/toolkits")).toBe(false);
    expect(isPublicRouteRequest("POST", "/v1/composio/toolkits/gmail/connect")).toBe(false);
  });

  test("allows public artifact share reads", () => {
    expect(isPublicRouteRequest("GET", "/v1/public/artifact-shares/tok123")).toBe(true);
  });

  test("allows GET /v1/auth/me without middleware auth but not PATCH", () => {
    expect(isPublicRouteRequest("GET", "/v1/auth/me")).toBe(true);
    expect(isPublicRouteRequest("PATCH", "/v1/auth/me")).toBe(false);
  });
});
