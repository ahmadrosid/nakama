import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./types";

/**
 * A minute is long enough that a burst of dashboard traffic does not trip the
 * limit, and short enough that a locked-out client recovers without support.
 */
const DEFAULT_WINDOW_MS = 60_000;

/**
 * Generous on purpose. One open dashboard already polls several endpoints, and
 * a whole office can share one address behind NAT, so this is sized to stop a
 * flood rather than to shape normal use.
 */
const DEFAULT_MAX = 600;

/**
 * The credential routes get their own, much smaller budget: bcrypt at cost 10
 * is the only thing slowing an online guess today.
 */
const DEFAULT_AUTH_MAX = 10;

/** Beyond this many live keys, expired ones are swept before inserting more. */
const SWEEP_AFTER_KEYS = 10_000;

/**
 * Credential routes, where a wrong guess is cheap for the caller and expensive
 * for us. Kept as exact paths: a prefix would also catch `/v1/auth/me`, which
 * the dashboard calls on every load.
 */
const AUTH_PATHS = new Set([
  "/v1/auth/login",
  "/v1/auth/accept-invite",
  "/v1/auth/setup",
]);

export interface RateLimitOptions {
  /** Requests per window for the auth paths, counted separately. */
  authMax?: number;
  /** Requests per window for everything outside the auth paths. */
  max?: number;
  /** Injected by tests so a window can elapse without waiting for one. */
  now?: () => number;
  /**
   * Read the client address from `X-Forwarded-For`. Off by default: the header
   * is client-settable, so trusting it without a proxy in front turns the
   * limiter into a formality.
   */
  trustProxy?: boolean;
  windowMs?: number;
}

interface Budget {
  count: number;
  resetAt: number;
}

function clientAddress(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  trustProxy: boolean
): string | null {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) {
      return forwarded;
    }
  }

  return c.env?.server?.requestIP?.(c.req.raw)?.address ?? null;
}

export function createRateLimitMiddleware(
  options: RateLimitOptions = {}
): MiddlewareHandler<AppEnv> {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const max = options.max ?? DEFAULT_MAX;
  const authMax = options.authMax ?? DEFAULT_AUTH_MAX;
  const trustProxy = options.trustProxy ?? false;
  const now = options.now ?? (() => Date.now());
  const budgets = new Map<string, Budget>();

  const sweep = (at: number) => {
    for (const [key, budget] of budgets) {
      if (budget.resetAt <= at) {
        budgets.delete(key);
      }
    }
  };

  return async (c, next) => {
    const address = clientAddress(c, trustProxy);

    // Bun hands us no address for a socket it cannot describe. Counting those
    // together would let one such caller lock out every other one, so they are
    // not counted at all.
    if (!address) {
      await next();
      return;
    }

    const isAuthPath = AUTH_PATHS.has(c.req.path);
    const limit = isAuthPath ? authMax : max;
    const key = `${isAuthPath ? "auth" : "general"}:${address}`;
    const at = now();

    if (budgets.size > SWEEP_AFTER_KEYS) {
      sweep(at);
    }

    const budget = budgets.get(key);
    const live = budget && budget.resetAt > at ? budget : null;

    if (!live) {
      budgets.set(key, { count: 1, resetAt: at + windowMs });
      await next();
      return;
    }

    live.count += 1;

    if (live.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((live.resetAt - at) / 1000));
      c.res = Response.json(
        { error: "Too many requests." },
        { headers: { "Retry-After": String(retryAfter) }, status: 429 }
      );
      return;
    }

    await next();
  };
}
