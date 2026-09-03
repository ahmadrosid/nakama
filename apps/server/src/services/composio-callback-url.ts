import {
  isValidBaseUrl,
  loadUserWebPublicUrl,
  NakamaApiError,
  normalizeBaseUrl,
  resolveWebPublicUrl,
  saveUserWebPublicUrl,
  type WebPublicUrlSettingsResponse,
} from "@nakama/core";

/**
 * The origin the caller claims. `clientOrigin` in the body, `Origin` and
 * `Referer` are all attacker-settable, and it ends up in an OAuth redirect_uri
 * and in share links, so an origin we cannot vouch for is refused rather than
 * echoed back into a generated URL.
 */
export function resolveRequestClientOrigin(
  request?: Request,
  explicitOrigin?: string
): string | undefined {
  const candidate = readClaimedOrigin(request, explicitOrigin);
  if (!candidate) {
    return;
  }

  if (!isValidBaseUrl(candidate)) {
    throw new NakamaApiError("Origin must be an http or https URL.", 400);
  }

  if (!isAllowedClientOrigin(candidate, request)) {
    throw new NakamaApiError("Origin is not allowed.", 400);
  }

  return candidate;
}

function readClaimedOrigin(
  request?: Request,
  explicitOrigin?: string
): string | undefined {
  const explicit = explicitOrigin?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  if (!request) {
    return;
  }

  const origin = request.headers.get("origin")?.trim();
  if (origin) {
    return origin.replace(/\/$/, "");
  }

  const referer = request.headers.get("referer")?.trim();
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // ignore invalid referer
    }
  }
}

/**
 * A configured public URL is the operator's answer and is the whole allowlist.
 * Without one the caller may still name the origin the request arrived on, or a
 * loopback origin, which is how the split-port dev setup (web on 3003, API on
 * 4310) and first-time setup work.
 */
function isAllowedClientOrigin(candidate: string, request?: Request): boolean {
  const configured = resolveWebPublicUrl();
  if (configured) {
    return sameHost(candidate, configured);
  }

  if (!request) {
    // Internal hop: an agent tool carries the origin its own HTTP route
    // already checked, and there is no request here to check it against.
    return true;
  }

  return (
    isLoopbackComposioCallbackBaseUrl(candidate) ||
    sameHost(candidate, resolveRequestSelfOrigin(request))
  );
}

/**
 * Host and port, not the whole origin: a TLS terminator that forwards without
 * X-Forwarded-Proto leaves the request looking like http while the browser
 * reports https, and the attack this refuses is a different host.
 */
function sameHost(a: string, b?: string): boolean {
  if (!b) {
    return false;
  }

  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

/** Where the request actually landed: the proxy's host if there is one. */
function resolveRequestSelfOrigin(request?: Request): string | undefined {
  if (!request) {
    return;
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.trim();
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto")?.trim() || "http";
    const forwarded = `${proto}://${forwardedHost}`;
    if (isValidBaseUrl(forwarded)) {
      return forwarded;
    }
  }

  try {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  } catch {}
}

export async function persistWebPublicUrl(input: string): Promise<string> {
  const trimmed = input.trim();
  if (!(trimmed && isValidBaseUrl(trimmed))) {
    throw new Error("webPublicUrl must be a valid http or https URL.");
  }

  return saveUserWebPublicUrl(normalizeBaseUrl(trimmed));
}

export async function getWebPublicUrlSettings(): Promise<WebPublicUrlSettingsResponse> {
  const envOverride =
    process.env.NAKAMA_WEB_PUBLIC_URL?.trim() ||
    process.env.NAKAMA_PUBLIC_URL?.trim();

  return {
    envOverride: envOverride ? normalizeBaseUrl(envOverride) : null,
    webPublicUrl: await loadUserWebPublicUrl(),
  };
}

/**
 * OAuth callback base URL. A configured public URL is the operator's answer and
 * wins: clientOrigin, Origin, Referer and X-Forwarded-Host all come from the
 * caller, and this base ends up in the redirect_uri an OAuth code is delivered
 * to. They still decide when nothing is configured, which is how a dev install
 * on localhost works.
 */
export function resolveComposioCallbackBaseUrl(
  options: { clientOrigin?: string; request?: Request } = {}
): string {
  // Resolved before the configured URL is returned, so a caller origin we do
  // not recognise is refused rather than quietly swapped for the right one.
  const fromBrowser = resolveRequestClientOrigin(
    options.request,
    options.clientOrigin
  );

  const configured = resolveWebPublicUrl();
  if (configured) {
    return configured;
  }

  if (fromBrowser) {
    return fromBrowser;
  }

  const self = resolveRequestSelfOrigin(options.request);
  if (self) {
    return self;
  }

  const webPort = process.env.NAKAMA_WEB_PORT?.trim() || "3003";
  return `http://127.0.0.1:${webPort}`;
}

/** True when the OAuth callback host is unreachable from a phone (Telegram / WhatsApp). */
export function isLoopbackComposioCallbackBaseUrl(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}
