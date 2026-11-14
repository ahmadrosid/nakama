---
title: "SSO sign-in trusts the provider for MFA, links accounts only on verified email, and erase must delete SSO links by hand"
author: Masb0ymas
date: 2026-11-14
branch: feat/oidc-by-pocket-id
cost: { minutes: 12, tokens: 202488 }
id: l-7bd34261
scope: repo
status: active
src: agent
touches:
  - apps/server/src/http/routes/oidc.ts
  - apps/server/src/services/oidc-service.ts
  - apps/server/src/services/org-service.ts
  - packages/db/src/adapters/sqlite.ts
  - docs/website/content/docs/sso.mdx
  - apps/server/src/services/oidc-config.ts
  - apps/server/src/services/oidc-jwt.ts
---

## Decided
- For SSO sign-ins the identity provider owns MFA. Nakama's own TOTP/passkey check is not applied after the OIDC redirect. The maintainer chose this over building a "MFA pending" session step or requiring an amr/acr claim. Operators enforce MFA in the IdP (Pocket ID is passkey-only).
- Linking an SSO identity to an existing account, and claiming a pending org invite, always require the provider's email_verified, even with NAKAMA_OIDC_REQUIRE_EMAIL_VERIFIED=false. That flag only relaxes creating brand-new accounts.
- NAKAMA_OIDC_LINK_EXISTING_ACCOUNTS stays on by default. The documented flow is "invite first, then first SSO login links". With linking off and auto-provision off, nobody can sign in with SSO. Nakama has no open sign-up, so a pre-registered-account takeover is not reachable.
- The OIDC state is bound to the starting browser with a cookie to stop login CSRF. The callback must land on the same host as /v1/auth/oidc/start.

## Tried and ruled out
- Defaulting account linking to off (audit suggestion): breaks the documented default setup.
- Forcing https on every discovery endpoint: breaks self-hosted Docker setups with an http issuer. Only an https issuer is blocked from listing http endpoints.

## Watch out
- SQLite runs with PRAGMA foreign_keys = OFF, so ON DELETE CASCADE never fires. Erasing a user is an UPDATE anyway. Any new table keyed by user_id needs an explicit DELETE in the erase transaction.
- Provider admin groups never demote the last active platform admin. Tests that expect a demotion need another active admin seeded.
- The 2 failing "organization parent migration" tests in packages/db already failed before the SSO changes.

In the code:
- apps/server/src/http/routes/oidc.ts: nakama_oidc_state cookie, orFailurePage
- apps/server/src/services/oidc-service.ts: resolveUser (verified-email gate), applyAdminGroups
- apps/server/src/services/org-service.ts: provisionOidcUser (emailVerified gates invites)
- packages/db/src/adapters/sqlite.ts: eraseUserTransaction, updateUserPlatformAdminStmt
- docs/website/content/docs/sso.mdx
