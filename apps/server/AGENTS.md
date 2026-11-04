# Server map

Routes, middleware and multi-tenancy. Root rules: [`../../AGENTS.md`](../../AGENTS.md). Tools and workspace paths: [`../../packages/core/AGENTS.md`](../../packages/core/AGENTS.md).

## Server

Hono in `apps/server/src/http/app.ts`. Middleware: auth → org → routes (`routes/*`). OpenAPI: `apps/server/src/http/openapi.ts` (`/openapi.json`). Routes that need an org admin or member call `requireOrgAdmin` / `requireOrgMember` (`apps/server/src/http/org-guards.ts`).

## Multi-tenancy

Orgs isolate profiles, sessions, automations, tools, MCP, skills, usage (`org_id` — see `packages/db/sql/schema.sql`, `migrateTenantOrgScope`).

**Org context:** every authed call except `/v1/auth/*` and `/v1/platform/*` needs `X-Org-Id` (`@nakama/client`) or the active org stored on the browser session (`active_org_id`, set by `POST /v1/auth/active-org`). Middleware: `apps/server/src/http/org-middleware.ts`; guards: `apps/server/src/http/org-guards.ts`.

| Change | Where |
|---|---|
| Org CRUD / invites / members | `apps/server/src/services/org-service.ts` |
| Platform org routes | `apps/server/src/http/routes/platform-orgs.ts` |
| Member routes | `apps/server/src/http/routes/org-members.ts` |
| Auth / active-org | `apps/server/src/http/routes/auth.ts` |
| DB types / SQLite | `packages/db/src/{types.ts,adapters/sqlite.ts}` |
| Contracts | `packages/core/src/contract.ts` |
| Client `X-Org-Id` | `packages/client/src/client.ts` |
| Web auth / switcher | `apps/web/src/context/auth-context.tsx`, `apps/web/src/components/OrgSwitcher.tsx` |
