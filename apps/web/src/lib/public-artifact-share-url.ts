const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
}

/**
 * Resolve a safe API origin for unauthenticated public artifact-share fetches.
 * Empty / relative baseUrl stays same-origin. Absolute URLs must be http(s);
 * localhost is rejected in production builds.
 */
export function resolvePublicArtifactShareOrigin(
  baseUrl: string,
  options?: { isProd?: boolean }
): string {
  const trimmed = baseUrl.trim().replace(/\/$/, "");
  if (!trimmed) {
    return "";
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("This share link is unavailable.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("This share link is unavailable.");
  }

  const isProd = options?.isProd ?? import.meta.env.PROD;
  if (isProd && isLocalHostname(parsed.hostname)) {
    throw new Error("This share link is unavailable.");
  }

  return trimmed;
}

export function buildPublicArtifactShareUrl(
  baseUrl: string,
  token: string,
  query?: string,
  options?: { isProd?: boolean }
): string {
  const origin = resolvePublicArtifactShareOrigin(baseUrl, options);
  const path = `/v1/public/artifact-shares/${encodeURIComponent(token)}`;
  const suffix = query ? `?${query}` : "";
  return `${origin}${path}${suffix}`;
}
