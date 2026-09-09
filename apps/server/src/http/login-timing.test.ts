import { describe, expect, test } from "bun:test";
import { AuthService } from "../services/auth-service";
import { setupTestConfigDir } from "../test-config-dir";
import { createMinimalHonoApp } from "./test-app-helpers";
import { setupFreshInstallSession } from "./test-session-helpers";

setupTestConfigDir("nakama-login-timing-test-");

class CountingAuthService extends AuthService {
  verifyCalls = 0;

  override verifyPassword(password: string, hash: string): Promise<boolean> {
    this.verifyCalls += 1;
    return super.verifyPassword(password, hash);
  }
}

async function login(app: { fetch: typeof fetch }, email: string) {
  return await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      body: JSON.stringify({ email, password: "wrong-password" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
}

describe("login does not reveal whether an account exists", () => {
  test("an unknown email still spends a password comparison", async () => {
    const authService = new CountingAuthService();
    const { app, databaseAdapter } = createMinimalHonoApp({ authService });
    await setupFreshInstallSession(app, databaseAdapter, "admin@example.com");

    const before = authService.verifyCalls;
    const unknown = await login(app, "nobody@example.com");
    const afterUnknown = authService.verifyCalls - before;

    const known = await login(app, "admin@example.com");
    const afterKnown = authService.verifyCalls - before - afterUnknown;

    expect(unknown.status).toBe(401);
    expect(known.status).toBe(401);
    // The point of the fix: both paths do the same work.
    expect(afterUnknown).toBe(afterKnown);
    expect(afterUnknown).toBe(1);
  }, 30_000);
});
