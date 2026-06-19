import { describe, expect, test, beforeEach } from "bun:test";
import { AuthService } from "./auth-service";

describe("AuthService", () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
  });

  describe("hashPassword", () => {
    test("returns a bcrypt hash", async () => {
      const hash = await authService.hashPassword("password123");
      expect(hash).toStartWith("$2");
      expect(hash.length).toBeGreaterThan(50);
    });

    test("different passwords produce different hashes", async () => {
      const hash1 = await authService.hashPassword("password1");
      const hash2 = await authService.hashPassword("password2");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("verifyPassword", () => {
    test("returns true for correct password", async () => {
      const hash = await authService.hashPassword("password123");
      const result = await authService.verifyPassword("password123", hash);
      expect(result).toBe(true);
    });

    test("returns false for incorrect password", async () => {
      const hash = await authService.hashPassword("password123");
      const result = await authService.verifyPassword("wrongpassword", hash);
      expect(result).toBe(false);
    });
  });

  describe("browser session helpers", () => {
    test("creates opaque browser session tokens and hashes them", () => {
      const session = authService.createBrowserSessionTokens();

      expect(session.sessionToken).not.toContain(".");
      expect(session.csrfToken).not.toContain(".");
      expect(session.sessionToken.length).toBeGreaterThan(50);
      expect(session.csrfToken.length).toBeGreaterThan(50);
      expect(new Date(session.expiresAt).toString()).not.toBe("Invalid Date");
      expect(authService.hashToken(session.sessionToken)).toHaveLength(43);
      expect(authService.hashToken(session.sessionToken)).not.toBe(session.sessionToken);
    });
  });
});
