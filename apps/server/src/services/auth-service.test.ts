import { beforeEach, describe, expect, test } from "bun:test";
import { AuthService } from "./auth-service";

describe("AuthService", () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
  });

  describe("hashPassword", () => {});

  describe("verifyPassword", () => {});

  describe("browser session helpers", () => {
    test("creates opaque browser session tokens and hashes them", () => {
      const session = authService.createBrowserSessionTokens();

      expect(session.sessionToken).not.toContain(".");
      expect(session.csrfToken).not.toContain(".");
      expect(session.sessionToken.length).toBeGreaterThan(50);
      expect(session.csrfToken.length).toBeGreaterThan(50);
      expect(new Date(session.expiresAt).toString()).not.toBe("Invalid Date");
      expect(authService.hashToken(session.sessionToken)).toHaveLength(43);
      expect(authService.hashToken(session.sessionToken)).not.toBe(
        session.sessionToken
      );
    });
  });
});
