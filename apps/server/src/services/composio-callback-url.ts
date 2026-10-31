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
    // The desktop app saves its loopback origin at setup and binds a new port
    // every launch, so a loopback URL vouches for loopback, not for one port.
    return (
      sameHost(candidate, configured) ||
      (isLoopbackComposioCallbackBaseUrl(configured) &&
        isLoopbackComposioCallbackBaseUrl(candidate))
    );
  }

  if (!request) {
    // Internal hop: an agent tool carries the origin its own HTTP route
    // already checked, and there is no request here to check it against.
    return true;
  }

  if (isLoopbackComposioCallbackBaseUrl(candidate)) {
    return true;
  }

  // A remote claim needs an origin the caller does not also control. Behind a
  // trusted proxy the forwarded headers name the deployment; without one, no
  // request signal vouches for a remote origin, because the caller controls
  // `Host` (and therefore `request.url`) just as much as `X-Forwarded-Host`.
  return (
    trustForwardedHeaders() &&
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

/**
 * Whether a trusted proxy owns the request's forwarding headers. Same contract
 * as the rate limiter (`http/app.ts`) and the deployment hardening docs: the
 * operator sets this only when the backend port is private and the proxy
 * replaces untrusted forwarded values. It gates every forwarded header this
 * file reads, `X-Forwarded-Host` and `X-Forwarded-Proto` alike. Without it a
 * caller names no remote origin here, because it controls `Host` (and so
 * `request.url`) just as much as the forwarded headers (issue #477).
 */
function trustForwardedHeaders(): boolean {
  return process.env.NAKAMA_TRUST_PROXY === "true";
}

/**
 * The origin the request actually landed on the listener, with no proxy header
 * involved. On a direct install this reflects the `Host` the caller sent, so
 * it anchors a real browser's own origin but must never vouch for a
 * caller-named remote origin on its own.
 */
function resolveRequestListenerOrigin(request?: Request): string | undefined {
  if (!request) {
    return;
  }

  try {
    const url = new URL(request.url);

    return `${url.protocol}//${url.host}`;
  } catch {}
}

/** Where the request landed: the proxy-named origin behind a trusted proxy, the listener otherwise. */
function resolveRequestSelfOrigin(request?: Request): string | undefined {
  if (!request) {
    return;
  }

  if (trustForwardedHeaders()) {
    const forwardedHost = request.headers.get("x-forwarded-host")?.trim();

    if (forwardedHost) {
      const proto = request.headers.get("x-forwarded-proto")?.trim() || "http";
      const forwarded = `${proto}://${forwardedHost}`;

      if (isValidBaseUrl(forwarded)) {
        return forwarded;
      }
    }
  }

  return resolveRequestListenerOrigin(request);
}

/**
 * The host a persisted callback base may name: the env override, the host the
 * request landed on, or a loopback origin. The saved value is deliberately
 * absent: it is the thing being checked, and a poisoned one would vouch for
 * itself. Deployments that serve the web app from another host than the API
 * set `NAKAMA_WEB_PUBLIC_URL`, which is what that override is for.
 */
function isDeploymentOrigin(candidate: string, request?: Request): boolean {
  const envOverride =
    process.env.NAKAMA_WEB_PUBLIC_URL?.trim() ||
    process.env.NAKAMA_PUBLIC_URL?.trim();

  if (envOverride && sameHost(candidate, envOverride)) {
    return true;
  }

  if (isLoopbackComposioCallbackBaseUrl(candidate)) {
    return true;
  }

  if (!request) {
    return false;
  }

  // The listener host anchors a direct install's own origin: the browser on
  // the page cannot lie about the `Host` it is talking to, and first-run setup
  // has nothing configured yet to check against. Forwarded headers only count
  // when the operator declared a trusted proxy; otherwise a caller could
  // persist an origin it controls and every later redirect_uri and share link
  // would use it (#477).
  if (sameHost(candidate, resolveRequestListenerOrigin(request))) {
    return true;
  }

  return (
    trustForwardedHeaders() &&
    sameHost(candidate, resolveRequestSelfOrigin(request))
  );
}

/**
 * Persist the install-wide callback/share base. The value lands in the
 * `redirect_uri` an OAuth state is delivered to, so it only ever names the
 * deployment's own origin.
 */
export async function persistWebPublicUrl(
  input: string,
  request?: Request
): Promise<string> {
  const trimmed = input.trim();

  if (!(trimmed && isValidBaseUrl(trimmed))) {
    throw new NakamaApiError(
      "webPublicUrl must be a valid http or https URL.",
      400
    );
  }

  if (!isDeploymentOrigin(trimmed, request)) {
    throw new NakamaApiError(
      "webPublicUrl must use this deployment's own origin. Set NAKAMA_WEB_PUBLIC_URL to serve the web app from another host.",
      400
    );
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
 * wins: clientOrigin, Origin and Referer all come from the caller, and this
 * base ends up in the redirect_uri an OAuth code is delivered to. They still
 * decide when nothing is configured, which is how a dev install on localhost
 * works — vouched for by loopback, or by the proxy-named origin when the
 * operator declared a trusted proxy (`NAKAMA_TRUST_PROXY`, issue #477).
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

  if (
    configured &&
    !(fromBrowser && isLoopbackComposioCallbackBaseUrl(configured))
  ) {
    return configured;
  }

  if (fromBrowser) {
    return fromBrowser;
  }

  return fallbackCallbackBaseUrl(options.request);
}

/**
 * Callback base for a request that arrives *from* the OAuth provider. Its
 * `Origin` and `Referer` belong to the provider, so the only answers worth
 * trusting are the configured public URL and the host the request landed on.
 */
export function resolveCallbackBaseUrlFromRedirect(request: Request): string {
  return resolveWebPublicUrl() ?? fallbackCallbackBaseUrl(request);
}

function fallbackCallbackBaseUrl(request?: Request): string {
  // Behind a trusted proxy the forwarded headers name the deployment, scheme
  // included, so CLI and API requests without an `Origin` still build an
  // https callback. On a direct install the caller controls `Host`, so
  // `request.url` names whatever the caller sent; deriving a remote base from
  // it would let the caller pin where an OAuth code is delivered (#477). Fail
  // closed to loopback and let the operator name the origin instead.
  const self = resolveRequestSelfOrigin(request);

  if (
    self &&
    (trustForwardedHeaders() || isLoopbackComposioCallbackBaseUrl(self))
  ) {
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
