import {
  isValidBaseUrl,
  loadUserWebPublicUrl,
  normalizeBaseUrl,
  resolveWebPublicUrl,
  saveUserWebPublicUrl,
  type WebPublicUrlSettingsResponse,
} from "@nakama/core";

export function resolveRequestClientOrigin(
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
 * on localhost works, and they have to parse as an http(s) URL to be used.
 */
export function resolveComposioCallbackBaseUrl(
  options: { clientOrigin?: string; request?: Request } = {}
): string {
  const configured = resolveWebPublicUrl();
  if (configured) {
    return configured;
  }

  const fromBrowser = resolveRequestClientOrigin(
    options.request,
    options.clientOrigin
  );
  if (fromBrowser && isValidBaseUrl(fromBrowser)) {
    return fromBrowser;
  }

  if (options.request) {
    const forwardedHost = options.request.headers.get("x-forwarded-host");
    const forwardedProto =
      options.request.headers.get("x-forwarded-proto") ?? "http";
    const forwarded = forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : null;

    if (forwarded && isValidBaseUrl(forwarded)) {
      return forwarded;
    }

    const url = new URL(options.request.url);
    return `${url.protocol}//${url.host}`;
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
