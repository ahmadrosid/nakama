import { describe, expect, test } from "bun:test";
import type { DatabaseAdapter } from "@nakama/db";
import type { AuthService } from "../services/auth-service";
import { setupTestConfigDir } from "../test-config-dir";
import { createMinimalHonoApp } from "./test-app-helpers";
import { buildSetupAuthBody } from "./test-org-helpers";
import type { HonoApp } from "./types";

/**
 * Session fixation through a sibling host (#1345).
 *
 * The requests below go through a cookie jar that applies the rules a browser
 * applies: `__Host-` cookies are rejected unless they are Secure, Path=/ and
 * carry no Domain attribute, and a cookie set for a parent domain is replayed
 * to every host underneath it. A sibling host can therefore plant an
 * unprefixed `nakama_session` for `example.com`, and the test asserts the
 * server refuses to authenticate that planted token.
 */

const VICTIM_ORIGIN = "https://nakama.example.com";
const SIBLING_ORIGIN = "https://evil.example.com";

setupTestConfigDir("nakama-host-cookie-test-");

interface JarCookie {
  createdAt: number;
  domain: string;
  hostOnly: boolean;
  name: string;
  path: string;
  secure: boolean;
  value: string;
}

class BrowserCookieJar {
  readonly rejected: string[] = [];
  private readonly cookies = new Map<string, JarCookie>();
  private sequence = 0;

  applySetCookies(origin: string, setCookies: string[]): void {
    for (const setCookie of setCookies) {
      this.applySetCookie(origin, setCookie);
    }
  }

  /** Cookies a browser would send to `origin`, most specific path first. */
  cookieHeader(origin: string): string {
    const url = new URL(origin);
    const secure = url.protocol === "https:";
    return [...this.cookies.values()]
      .filter(
        (cookie) =>
          this.matchesDomain(cookie, url.hostname) &&
          (url.pathname === cookie.path ||
            url.pathname.startsWith(
              cookie.path.endsWith("/") ? cookie.path : `${cookie.path}/`
            )) &&
          (!cookie.secure || secure)
      )
      .sort(
        (a, b) => b.path.length - a.path.length || a.createdAt - b.createdAt
      )
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  }

  private applySetCookie(origin: string, setCookie: string): void {
    const url = new URL(origin);
    const [pair = "", ...rawAttributes] = setCookie.split(";");
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    const attributes = new Map(
      rawAttributes.map((attribute) => {
        const index = attribute.indexOf("=");
        return index === -1
          ? ([attribute.trim().toLowerCase(), ""] as const)
          : ([
              attribute.slice(0, index).trim().toLowerCase(),
              attribute.slice(index + 1).trim(),
            ] as const);
      })
    );

    const domainAttribute = attributes.get("domain")?.toLowerCase();
    const path = attributes.get("path") || "/";
    const key = `${name}|${domainAttribute ?? url.hostname}|${path}`;
    const maxAge = Number(attributes.get("max-age") ?? Number.NaN);

    if (Number.isFinite(maxAge) && maxAge <= 0) {
      this.cookies.delete(key);
      return;
    }

    if (
      name.startsWith("__Host-") &&
      (!attributes.has("secure") ||
        attributes.get("path") !== "/" ||
        domainAttribute !== undefined)
    ) {
      this.rejected.push(setCookie);
      return;
    }

    if (
      domainAttribute !== undefined &&
      !this.domainMatches(url.hostname, domainAttribute)
    ) {
      this.rejected.push(setCookie);
      return;
    }

    this.cookies.set(key, {
      createdAt: this.sequence++,
      domain: domainAttribute ?? url.hostname,
      hostOnly: domainAttribute === undefined,
      name,
      path,
      secure: attributes.has("secure"),
      value,
    });
  }

  private domainMatches(host: string, domain: string): boolean {
    return host === domain || host.endsWith(`.${domain}`);
  }

  private matchesDomain(cookie: JarCookie, host: string): boolean {
    return cookie.hostOnly
      ? cookie.domain === host
      : this.domainMatches(host, cookie.domain);
  }
}

function cookiePair(setCookie: string): { name: string; value: string } {
  const [pair = ""] = setCookie.split(";");
  const separator = pair.indexOf("=");
  return {
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1).trim(),
  };
}

async function requestApp(
  app: HonoApp,
  jar: BrowserCookieJar,
  origin: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookie = jar.cookieHeader(origin);
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  const response = await app.fetch(
    new Request(`${origin}${path}`, { ...init, headers })
  );
  jar.applySetCookies(origin, response.headers.getSetCookie());
  return response;
}

async function bootstrapAdmin(
  app: HonoApp,
  jar: BrowserCookieJar,
  origin: string
): Promise<Response> {
  return requestApp(app, jar, origin, "/v1/auth/setup", {
    body: JSON.stringify(buildSetupAuthBody()),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

function sessionCookieValue(response: Response): string {
  const setCookie = response.headers
    .getSetCookie()
    .find((entry) => entry.startsWith("__Host-nakama_session="));
  if (!setCookie) {
    throw new Error("Login did not issue a host-bound session cookie.");
  }

  return cookiePair(setCookie).value;
}

/** A real, valid session pair belonging to an account the attacker owns. */
async function createAttackerSession(
  app: HonoApp,
  authService: AuthService,
  databaseAdapter: DatabaseAdapter
): Promise<{ csrf: string; session: string }> {
  const email = "attacker@evil.example";
  const now = new Date().toISOString();
  await databaseAdapter.createUser({
    createdAt: now,
    email,
    id: crypto.randomUUID(),
    name: "Mallory",
    passwordHash: await authService.hashPassword("password123"),
    phone: "",
    updatedAt: now,
  });

  const response = await app.fetch(
    new Request(`${SIBLING_ORIGIN}/v1/auth/login`, {
      body: JSON.stringify({ email, password: "password123" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  if (response.status !== 200) {
    throw new Error(`Attacker login failed: ${response.status}`);
  }

  const values = new Map(
    response.headers
      .getSetCookie()
      .map(cookiePair)
      .map(({ name, value }) => [name, value])
  );
  const session = values.get("__Host-nakama_session");
  const csrf = values.get("__Host-nakama_csrf");
  if (!(session && csrf)) {
    throw new Error("Attacker login did not issue host-bound cookies.");
  }

  return { csrf, session };
}

describe("host-bound browser session cookies", () => {
  test("serves HTTPS sessions in host-bound cookies a sibling host cannot set", async () => {
    const { app } = createMinimalHonoApp();
    const jar = new BrowserCookieJar();

    const setup = await bootstrapAdmin(app, jar, VICTIM_ORIGIN);
    expect(setup.status).toBe(201);

    const issued = setup.headers.getSetCookie();
    const sessionCookie = issued.find((entry) =>
      entry.startsWith("__Host-nakama_session=")
    );
    const csrfCookie = issued.find((entry) =>
      entry.startsWith("__Host-nakama_csrf=")
    );
    expect(sessionCookie).toBeDefined();
    expect(csrfCookie).toBeDefined();
    // The prefix is only honoured when the cookie is Secure, Path=/ and has
    // no Domain attribute; anything else and the browser drops the cookie.
    expect(sessionCookie).toContain("Secure");
    expect(sessionCookie).toContain("Path=/");
    expect(sessionCookie).not.toContain("Domain=");
    // A pre-migration cookie must not survive the upgrade.
    expect(
      issued.some(
        (entry) =>
          cookiePair(entry).name === "nakama_session" &&
          entry.includes("Max-Age=0")
      )
    ).toBe(true);

    // The sibling host cannot set or overwrite either cookie: the host-bound
    // prefix is refused as soon as a Domain attribute is added.
    jar.applySetCookies(SIBLING_ORIGIN, [
      `${sessionCookie}; Domain=example.com`,
      `${csrfCookie}; Domain=example.com`,
    ]);
    expect(jar.rejected).toHaveLength(2);

    const me = await requestApp(app, jar, VICTIM_ORIGIN, "/v1/auth/me");
    expect(me.status).toBe(200);
    expect(((await me.json()) as { email: string }).email).toBe(
      "admin@example.com"
    );
  });

  test("rejects a sibling-domain session planted by an attacker", async () => {
    const { app, authService, databaseAdapter } = createMinimalHonoApp();
    const attacker = await createAttackerSession(
      app,
      authService,
      databaseAdapter
    );

    // The attacker controls a sibling host and sets a parent-domain cookie.
    const victimJar = new BrowserCookieJar();
    victimJar.applySetCookies(SIBLING_ORIGIN, [
      `nakama_session=${attacker.session}; Domain=example.com; Path=/; HttpOnly; Secure; SameSite=Lax`,
      `nakama_csrf=${attacker.csrf}; Domain=example.com; Path=/; Secure; SameSite=Lax`,
    ]);
    expect(victimJar.cookieHeader(VICTIM_ORIGIN)).toContain(
      `nakama_session=${attacker.session}`
    );

    // The victim has no host-bound cookie, so the planted token is the only
    // session the server sees — and it must not authenticate anyone.
    const me = await requestApp(app, victimJar, VICTIM_ORIGIN, "/v1/auth/me");
    expect(me.status).toBe(401);

    // A CSRF-protected write must refuse the planted pair too.
    const write = await requestApp(
      app,
      victimJar,
      VICTIM_ORIGIN,
      "/v1/auth/logout",
      { headers: { "X-CSRF-Token": attacker.csrf }, method: "POST" }
    );
    expect(write.status).toBe(401);

    // The attacker's own session is untouched, so nothing here revoked it.
    const attackerCheck = await app.fetch(
      new Request(`${SIBLING_ORIGIN}/v1/auth/sessions`, {
        headers: {
          Cookie: `__Host-nakama_session=${attacker.session}; __Host-nakama_csrf=${attacker.csrf}`,
        },
      })
    );
    expect(attackerCheck.status).toBe(200);
  });

  test("authenticates the real host-bound session next to a planted legacy cookie", async () => {
    const { app } = createMinimalHonoApp();
    const jar = new BrowserCookieJar();
    await bootstrapAdmin(app, jar, VICTIM_ORIGIN);

    jar.applySetCookies(SIBLING_ORIGIN, [
      "nakama_session=planted; Domain=example.com; Path=/; HttpOnly; Secure; SameSite=Lax",
    ]);

    const me = await requestApp(app, jar, VICTIM_ORIGIN, "/v1/auth/me");
    expect(me.status).toBe(200);
    expect(((await me.json()) as { email: string }).email).toBe(
      "admin@example.com"
    );
  });

  test("rejects a pre-migration unprefixed cookie on HTTPS", async () => {
    const { app } = createMinimalHonoApp();
    const jar = new BrowserCookieJar();
    const setup = await bootstrapAdmin(app, jar, VICTIM_ORIGIN);
    expect(setup.status).toBe(201);

    // A user upgrading mid-session still holds the unprefixed host-only pair.
    const legacyJar = new BrowserCookieJar();
    legacyJar.applySetCookies(VICTIM_ORIGIN, [
      `nakama_session=${sessionCookieValue(setup)}; Path=/; HttpOnly; SameSite=Lax`,
    ]);

    const me = await requestApp(app, legacyJar, VICTIM_ORIGIN, "/v1/auth/me");
    expect(me.status).toBe(401);
  });

  test("keeps plain HTTP deployments on unprefixed cookies", async () => {
    const { app } = createMinimalHonoApp();
    const origin = "http://localhost:4310";
    const jar = new BrowserCookieJar();

    const setup = await bootstrapAdmin(app, jar, origin);
    expect(setup.status).toBe(201);
    const issuedNames = setup.headers.getSetCookie().map(cookiePair);
    expect(issuedNames.map(({ name }) => name)).toContain("nakama_session");
    expect(issuedNames.map(({ name }) => name)).not.toContain(
      "__Host-nakama_session"
    );

    const me = await requestApp(app, jar, origin, "/v1/auth/me");
    expect(me.status).toBe(200);

    const csrf = jar
      .cookieHeader(origin)
      .split("; ")
      .find((entry) => entry.startsWith("nakama_csrf="))!
      .split("=")[1]!;
    const logout = await requestApp(app, jar, origin, "/v1/auth/logout", {
      headers: { "X-CSRF-Token": csrf },
      method: "POST",
    });
    expect(logout.status).toBe(200);
    // Logout clears the host-bound pair too, so a scheme drift on the same
    // browser cannot leave a live session behind.
    expect(jar.cookieHeader(origin)).not.toContain("nakama_session=");
    expect(jar.cookieHeader(origin)).not.toContain("__Host-nakama_session=");
  });
});
