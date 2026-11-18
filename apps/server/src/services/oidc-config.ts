export interface OidcConfig {
  adminGroups: string[];
  allowedDomains: string[];
  autoProvision: boolean;
  clientId: string;
  clientSecret: string;
  defaultOrgSlug?: string;
  disablePasswordLogin: boolean;
  groupsClaim: string;
  issuerUrl: string;
  linkExistingAccounts: boolean;
  providerName: string;
  redirectUrl?: string;
  requireEmailVerified: boolean;
  scopes: string;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off", ""].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value "${value}".`);
}

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function assertHttpUrl(value: string, name: string): void {
  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("not http");
    }
  } catch {
    throw new Error(`${name} must be an http or https URL.`);
  }
}

/**
 * Read the `NAKAMA_OIDC_*` environment. `null` means SSO is off; a partial or
 * malformed configuration throws so the server refuses to start instead of
 * advertising a login that cannot work — same contract as Rustrak.
 */
export function loadOidcConfig(
  env: Record<string, string | undefined> = process.env
): OidcConfig | null {
  const issuerUrl = env.NAKAMA_OIDC_ISSUER_URL?.trim().replace(/\/+$/, "");

  const disablePasswordLogin = flag(
    env.NAKAMA_OIDC_DISABLE_PASSWORD_LOGIN,
    false
  );

  if (!issuerUrl) {
    if (disablePasswordLogin) {
      throw new Error(
        "NAKAMA_OIDC_DISABLE_PASSWORD_LOGIN requires NAKAMA_OIDC_ISSUER_URL: with password login off and no provider, nobody could sign in."
      );
    }

    return null;
  }

  assertHttpUrl(issuerUrl, "NAKAMA_OIDC_ISSUER_URL");

  const clientId = env.NAKAMA_OIDC_CLIENT_ID?.trim();
  const clientSecret = env.NAKAMA_OIDC_CLIENT_SECRET?.trim();

  const missing = [
    ["NAKAMA_OIDC_CLIENT_ID", clientId],
    ["NAKAMA_OIDC_CLIENT_SECRET", clientSecret],
  ].flatMap(([name, value]) => (value ? [] : [name]));

  if (missing.length > 0) {
    throw new Error(
      `OIDC is enabled (NAKAMA_OIDC_ISSUER_URL) but missing: ${missing.join(", ")}.`
    );
  }

  const redirectUrl = env.NAKAMA_OIDC_REDIRECT_URL?.trim().replace(/\/+$/, "");

  if (redirectUrl) {
    assertHttpUrl(redirectUrl, "NAKAMA_OIDC_REDIRECT_URL");
  }

  const autoProvision = flag(env.NAKAMA_OIDC_AUTO_PROVISION, false);

  const allowedDomains = csv(env.NAKAMA_OIDC_ALLOWED_DOMAINS).map((domain) =>
    domain.toLowerCase()
  );

  if (autoProvision && allowedDomains.length === 0) {
    console.warn(
      "[oidc] NAKAMA_OIDC_AUTO_PROVISION is on with no NAKAMA_OIDC_ALLOWED_DOMAINS: anyone the provider signs in gets an account."
    );
  }

  const scopes = env.NAKAMA_OIDC_SCOPES?.trim() || "openid email profile";

  if (!scopes.split(/\s+/).includes("openid")) {
    throw new Error('NAKAMA_OIDC_SCOPES must include "openid".');
  }

  return {
    adminGroups: csv(env.NAKAMA_OIDC_ADMIN_GROUPS),
    allowedDomains,
    autoProvision,
    clientId: clientId!,
    clientSecret: clientSecret!,
    defaultOrgSlug:
      env.NAKAMA_OIDC_DEFAULT_ORG?.trim().toLowerCase() || undefined,
    disablePasswordLogin,
    groupsClaim: env.NAKAMA_OIDC_GROUPS_CLAIM?.trim() || "groups",
    issuerUrl,
    linkExistingAccounts: flag(env.NAKAMA_OIDC_LINK_EXISTING_ACCOUNTS, true),
    providerName: env.NAKAMA_OIDC_PROVIDER_NAME?.trim() || "SSO",
    redirectUrl: redirectUrl || undefined,
    requireEmailVerified: flag(env.NAKAMA_OIDC_REQUIRE_EMAIL_VERIFIED, true),
    scopes,
  };
}
