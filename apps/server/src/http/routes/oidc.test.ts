import { describe, expect, test } from "bun:test";
import { sign as cryptoSign, generateKeyPairSync } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "../../services/auth-service";
import type { OidcConfig } from "../../services/oidc-service";
import { OidcService } from "../../services/oidc-service";
import { OrgService } from "../../services/org-service";
import { createMinimalHonoApp } from "../test-app-helpers";

const ISSUER = "https://pocketid.example.com";

const CLIENT_ID = "nakama-web";

function config(overrides: Partial<OidcConfig> = {}): OidcConfig {
  return {
    adminGroups: [],
    allowedDomains: [],
    autoProvision: true,
    clientId: CLIENT_ID,
    clientSecret: "secret-value",
    disablePasswordLogin: false,
    groupsClaim: "groups",
    issuerUrl: ISSUER,
    linkExistingAccounts: true,
    providerName: "Pocket ID",
    requireEmailVerified: true,
    scopes: "openid email profile",
    ...overrides,
  };
}

function fakeProvider(issuer = ISSUER) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key" };
  let currentIdToken = "";

  const fetchImpl = async (
    input: string | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = String(input);

    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Response.json({
        authorization_endpoint: `${issuer}/authorize`,
        issuer,
        jwks_uri: `${issuer}/jwks`,
        token_endpoint: `${issuer}/token`,
      });
    }

    if (url === `${issuer}/jwks`) {
      return Response.json({ keys: [jwk] });
    }

    if (url === `${issuer}/token`) {
      return Response.json({ access_token: "at", id_token: currentIdToken });
    }

    return new Response("not found", { status: 404 });
  };

  const signIdToken = (claims: {
    aud?: string;
    email?: string;
    email_verified?: boolean;
    exp?: number;
    iss?: string;
    nonce?: string | null;
    sub?: string;
  }): void => {
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })
    ).toString("base64url");

    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");

    currentIdToken = `${header}.${payload}.${cryptoSign(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      privateKey
    ).toString("base64url")}`;
  };

  return { fetchImpl, signIdToken };
}

async function createApp(configOverrides: Partial<OidcConfig> = {}) {
  process.env.NAKAMA_CONFIG_DIR = await mkdtemp(
    join(tmpdir(), "nakama-oidc-route-")
  );

  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const orgService = new OrgService(databaseAdapter, authService);
  const provider = fakeProvider();

  const oidcService = new OidcService(
    {
      authService,
      databaseAdapter,
      fetch: provider.fetchImpl,
      orgService,
    },
    config(configOverrides)
  );

  const { app } = createMinimalHonoApp({
    databaseAdapter,
    oidcService,
  });

  return { app, databaseAdapter, provider };
}

describe("OIDC routes", () => {
  test("start redirects to the provider and callback issues a session", async () => {
    const { app, provider } = await createApp();

    const start = await app.fetch(
      new Request("http://localhost:4310/v1/auth/oidc/start", {
        headers: { Origin: "http://localhost:4310" },
        redirect: "manual",
      })
    );

    expect(start.status).toBe(302);
    expect(start.headers.get("cache-control")).toBe("no-store");
    const authorizeUrl = new URL(start.headers.get("location")!);
    expect(authorizeUrl.origin).toBe(ISSUER);

    const stateCookie = start.headers
      .getAll("set-cookie")
      .find((cookie) => cookie.startsWith("nakama_oidc_state="))!
      .split(";")[0];

    provider.signIdToken({
      aud: CLIENT_ID,
      email: "sso@example.com",
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 300,
      iss: ISSUER,
      nonce: authorizeUrl.searchParams.get("nonce"),
      sub: "sub-1",
    });

    const callback = await app.fetch(
      new Request(
        `http://localhost:4310/v1/auth/oidc/callback?code=abc&state=${authorizeUrl.searchParams.get("state")}`,
        { headers: { Cookie: stateCookie }, redirect: "manual" }
      )
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.get("cache-control")).toBe("no-store");
    expect(callback.headers.get("location")).toBe("http://localhost:4310/");

    const cookies = callback.headers.getAll("set-cookie").join(";");
    expect(cookies).toContain("nakama_session=");
    expect(cookies).toContain("nakama_csrf=");
  });

  test("a callback URL replayed in another browser does not sign it in", async () => {
    const { app, databaseAdapter, provider } = await createApp();

    // The attacker starts the flow and signs in at the provider as themselves.
    const start = await app.fetch(
      new Request("http://localhost:4310/v1/auth/oidc/start", {
        headers: { Origin: "http://localhost:4310" },
        redirect: "manual",
      })
    );

    const authorizeUrl = new URL(start.headers.get("location")!);
    const state = authorizeUrl.searchParams.get("state");

    provider.signIdToken({
      aud: CLIENT_ID,
      email: "attacker@example.com",
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 300,
      iss: ISSUER,
      nonce: authorizeUrl.searchParams.get("nonce"),
      sub: "attacker",
    });

    // The victim's browser opens the callback without the state cookie.
    const forged = await app.fetch(
      new Request(
        `http://localhost:4310/v1/auth/oidc/callback?code=abc&state=${state}`,
        { headers: { Cookie: "nakama_oidc_state=other" }, redirect: "manual" }
      )
    );

    expect(forged.status).toBe(400);
    expect(forged.headers.getAll("set-cookie").join(";")).not.toContain(
      "nakama_session="
    );
    expect(await databaseAdapter.countHumanUsers()).toBe(0);
  });

  test("an unexpected failure hides the internal detail", async () => {
    const { app } = await createApp({
      issuerUrl: "https://unreachable.example.com",
    });

    const start = await app.fetch(
      new Request("http://localhost:4310/v1/auth/oidc/start", {
        headers: { Origin: "http://localhost:4310" },
      })
    );

    expect(start.status).toBe(502);
    expect(await start.text()).not.toContain("unreachable.example.com");
  });

  test("callback with a bogus state shows the error page", async () => {
    const { app } = await createApp();

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/auth/oidc/callback?code=abc&state=bogus"
      )
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Sign-in failed");
  });

  test("password login is refused for everyone but the first account when SSO-only", async () => {
    const { app, databaseAdapter } = await createApp({
      disablePasswordLogin: true,
    });

    const now = new Date().toISOString();
    const auth = new AuthService();

    await databaseAdapter.createUser({
      createdAt: now,
      email: "admin@example.com",
      id: "user_admin",
      name: "Admin",
      passwordHash: await auth.hashPassword("password123"),
      updatedAt: now,
    });
    await databaseAdapter.createUser({
      createdAt: now,
      email: "member@example.com",
      id: "user_member",
      name: "Member",
      passwordHash: await auth.hashPassword("password123"),
      updatedAt: now,
    });

    const memberLogin = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "member@example.com",
          password: "password123",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(memberLogin.status).toBe(403);
    expect((await memberLogin.json()).error).toContain("Pocket ID");

    // A wrong password and an unknown email answer the same, so the gate is
    // not an oracle for guessed credentials or account existence.
    for (const credentials of [
      { email: "member@example.com", password: "wrong-password" },
      { email: "nobody@example.com", password: "password123" },
    ]) {
      const guess = await app.fetch(
        new Request("http://localhost:4310/v1/auth/login", {
          body: JSON.stringify(credentials),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );

      expect(guess.status).toBe(403);
    }

    const breakGlass = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "admin@example.com",
          password: "password123",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(breakGlass.status).toBe(200);
  });

  test("health advertises the provider and the password gate", async () => {
    const { app } = await createApp({ disablePasswordLogin: true });

    const health = await app.fetch(new Request("http://localhost:4310/health"));

    expect(health.status).toBe(200);
    const body = await health.json();
    expect(body.oidcConfigured).toBe(true);
    expect(body.oidcProviderName).toBe("Pocket ID");
    expect(body.passwordLoginEnabled).toBe(false);
  });

  test("health reports no SSO and passwords on when OIDC is off", async () => {
    const { app } = createMinimalHonoApp({
      databaseAdapter: createInMemoryDatabaseAdapter(),
    });

    const health = await app.fetch(new Request("http://localhost:4310/health"));
    const body = await health.json();

    expect(body.oidcConfigured).toBe(false);
    expect(body.oidcProviderName).toBeNull();
    expect(body.passwordLoginEnabled).toBe(true);
  });
});
