import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createRateLimitMiddleware } from "./rate-limit-middleware";
import type { AppEnv } from "./types";

const WINDOW_MS = 1000;

function buildApp(
  overrides: Parameters<typeof createRateLimitMiddleware>[0] = {}
) {
  const app = new Hono<AppEnv>();
  app.use(
    "*",
    createRateLimitMiddleware({ windowMs: WINDOW_MS, ...overrides })
  );
  app.all("*", (c) => c.json({ ok: true }));
  return app;
}

function envFor(address: string | null) {
  return { server: { requestIP: () => (address ? { address } : null) } };
}

function call(
  app: ReturnType<typeof buildApp>,
  path = "/v1/anything",
  address: string | null = "10.0.0.1",
  headers: Record<string, string> = {}
) {
  return app.fetch(
    new Request(`http://localhost:4310${path}`, { headers }),
    envFor(address)
  );
}

describe("createRateLimitMiddleware", () => {
  test("lets a client through while it still has budget", async () => {
    const app = buildApp({ max: 5 });
    const statuses: number[] = [];

    for (let i = 0; i < 5; i++) {
      statuses.push((await call(app)).status);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200]);
  });

  test("answers 429 with Retry-After once the budget is spent", async () => {
    const app = buildApp({ max: 2 });

    await call(app);
    await call(app);
    const blocked = await call(app);

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  test("starts a fresh budget once the window has passed", async () => {
    let clock = 1000;
    const app = buildApp({ max: 1, now: () => clock });

    expect((await call(app)).status).toBe(200);
    expect((await call(app)).status).toBe(429);

    clock += WINDOW_MS + 1;

    expect((await call(app)).status).toBe(200);
  });

  test("keeps one budget per client address", async () => {
    const app = buildApp({ max: 1 });

    expect((await call(app, "/v1/anything", "10.0.0.1")).status).toBe(200);
    expect((await call(app, "/v1/anything", "10.0.0.1")).status).toBe(429);
    expect((await call(app, "/v1/anything", "10.0.0.2")).status).toBe(200);
  });

  test("spends a separate, stricter budget on the auth routes", async () => {
    const app = buildApp({ authMax: 1, max: 50 });

    expect((await call(app, "/v1/auth/login")).status).toBe(200);
    expect((await call(app, "/v1/auth/login")).status).toBe(429);
    // The general budget is untouched by the auth spend.
    expect((await call(app, "/v1/anything")).status).toBe(200);
  });

  test("ignores a forwarded address when the proxy is not trusted", async () => {
    const app = buildApp({ max: 1 });
    const spoofed = { "x-forwarded-for": "203.0.113.9" };

    expect((await call(app, "/v1/anything", "10.0.0.1", spoofed)).status).toBe(
      200
    );
    // A different forwarded value must not buy a fresh budget.
    expect(
      (
        await call(app, "/v1/anything", "10.0.0.1", {
          "x-forwarded-for": "203.0.113.10",
        })
      ).status
    ).toBe(429);
  });

  test("uses the forwarded address when the proxy is trusted", async () => {
    const app = buildApp({ max: 1, trustProxy: true });

    expect(
      (
        await call(app, "/v1/anything", "10.0.0.1", {
          "x-forwarded-for": "203.0.113.9",
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call(app, "/v1/anything", "10.0.0.1", {
          "x-forwarded-for": "203.0.113.10",
        })
      ).status
    ).toBe(200);
  });

  test("lets the request through when no address can be resolved", async () => {
    const app = buildApp({ max: 1 });

    expect((await call(app, "/v1/anything", null)).status).toBe(200);
    expect((await call(app, "/v1/anything", null)).status).toBe(200);
  });
});
