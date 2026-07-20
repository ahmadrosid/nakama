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
  explicitOrigin?: string,
): string | undefined {
  const explicit = explicitOrigin?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  if (!request) {
    return undefined;
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

  return undefined;
}

export async function persistWebPublicUrl(input: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed || !isValidBaseUrl(trimmed)) {
    throw new Error("webPublicUrl must be a valid http or https URL.");
  }

  return saveUserWebPublicUrl(new URL(trimmed).origin);
}

export async function getWebPublicUrlSettings(): Promise<WebPublicUrlSettingsResponse> {
  const envOverride =
    process.env.NAKAMA_WEB_PUBLIC_URL?.trim() || process.env.NAKAMA_PUBLIC_URL?.trim();

  return {
    webPublicUrl: await loadUserWebPublicUrl(),
    envOverride: envOverride ? normalizeBaseUrl(envOverride) : null,
  };
}

/** OAuth callback base URL — prefers the browser origin from the active request. */
export function resolveComposioCallbackBaseUrl(options: {
  clientOrigin?: string;
  request?: Request;
} = {}): string {
  const fromBrowser = resolveRequestClientOrigin(options.request, options.clientOrigin);
  if (fromBrowser) {
    return fromBrowser;
  }

  if (options.request) {
    const forwardedHost = options.request.headers.get("x-forwarded-host");
    if (forwardedHost) {
      const forwardedProto = options.request.headers.get("x-forwarded-proto") ?? "http";
      return `${forwardedProto}://${forwardedHost}`;
    }

    const url = new URL(options.request.url);
    return `${url.protocol}//${url.host}`;
  }

  const configured = resolveWebPublicUrl();
  if (configured) {
    return configured;
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
