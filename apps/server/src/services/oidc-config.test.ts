import { describe, expect, test } from "bun:test";
import { loadOidcConfig } from "./oidc-config";

const ISSUER = "https://pocketid.example.com";

describe("loadOidcConfig", () => {
  test("returns null when the issuer is not set", () => {
    expect(loadOidcConfig({})).toBeNull();
  });

  test("throws when password login is disabled without a provider", () => {
    expect(() =>
      loadOidcConfig({ NAKAMA_OIDC_DISABLE_PASSWORD_LOGIN: "1" })
    ).toThrow(/requires NAKAMA_OIDC_ISSUER_URL/);
  });

  test("throws on a partial config instead of serving a broken button", () => {
    expect(() => loadOidcConfig({ NAKAMA_OIDC_ISSUER_URL: ISSUER })).toThrow(
      /NAKAMA_OIDC_CLIENT_ID/
    );
    expect(() =>
      loadOidcConfig({
        NAKAMA_OIDC_CLIENT_ID: "x",
        NAKAMA_OIDC_ISSUER_URL: ISSUER,
      })
    ).toThrow(/NAKAMA_OIDC_CLIENT_SECRET/);
  });

  test("normalizes the issuer and reads the optional knobs", () => {
    const config = loadOidcConfig({
      NAKAMA_OIDC_ADMIN_GROUPS: " admins ,ops ",
      NAKAMA_OIDC_ALLOWED_DOMAINS: "Example.com, corp.test",
      NAKAMA_OIDC_AUTO_PROVISION: "true",
      NAKAMA_OIDC_CLIENT_ID: "id",
      NAKAMA_OIDC_CLIENT_SECRET: "secret",
      NAKAMA_OIDC_DEFAULT_ORG: " Acme ",
      NAKAMA_OIDC_ISSUER_URL: `${ISSUER}/`,
      NAKAMA_OIDC_PROVIDER_NAME: "Pocket ID",
    });

    expect(config?.issuerUrl).toBe(ISSUER);
    expect(config?.providerName).toBe("Pocket ID");
    expect(config?.adminGroups).toEqual(["admins", "ops"]);
    expect(config?.allowedDomains).toEqual(["example.com", "corp.test"]);
    expect(config?.defaultOrgSlug).toBe("acme");
    expect(config?.requireEmailVerified).toBe(true);
    expect(config?.disablePasswordLogin).toBe(false);
  });

  test("rejects a non-http issuer and scopes without openid", () => {
    expect(() =>
      loadOidcConfig({
        NAKAMA_OIDC_CLIENT_ID: "id",
        NAKAMA_OIDC_CLIENT_SECRET: "s",
        NAKAMA_OIDC_ISSUER_URL: "ftp://x",
      })
    ).toThrow(Error);
    expect(() =>
      loadOidcConfig({
        NAKAMA_OIDC_CLIENT_ID: "id",
        NAKAMA_OIDC_CLIENT_SECRET: "s",
        NAKAMA_OIDC_ISSUER_URL: ISSUER,
        NAKAMA_OIDC_SCOPES: "email profile",
      })
    ).toThrow(/openid/);
  });
});
