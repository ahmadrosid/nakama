# Remove backend API keys and app-user scope

Status: implementation plan only. No product code has changed.

## Goal

Remove Nakama's organization backend API keys and the external-app integration they enable, including `appUserId`. Remove the dashboard controls, server support, client methods, and documentation together.

Start implementation from latest `main`, including PR #1580. Do not simply revert that PR: it fixed one part of a feature implemented across several packages.

## Scope

Remove:

- Organization key creation, listing, rotation, and deletion.
- Authentication with `nk_live_*` and `nk_test_*` secrets.
- Public `appUserId` fields, `X-Nakama-App-User-Id`, and `forAppUser()`.
- Creation and execution of app-user sessions and private workspaces.
- The backend integration guide and dashboard integration prompts.

Keep browser login, local CLI/worker tokens, organization membership, normal profile sessions, and channel integrations. Keep provider, Composio, web-search, custom-tool, and notification-webhook credentials: those are separate features, even when their fields are called `apiKey` or use `x-api-key`. Keep organization default profiles; they are also used when creating organizations.

## Intended behavior

1. **Organization UI:** the Backend API keys section and its create/rotate/delete dialogs disappear. Other organization controls continue working.
2. **Authentication:** retired Nakama keys return 401 on protected requests. Browser sessions and local tokens retain their current authentication and organization rules.
3. **Routes:** `/v1/orgs/:orgId/api-keys` and its child routes disappear from routing and OpenAPI. Authenticated requests to these removed endpoints return 404.
4. **Sessions:** ordinary sessions use profile workspaces. After authentication, session creation rejects the presence of the removed `appUserId` field with 400, including null or empty values; session and artifact routes reject the retired app-user header with 400. Old clients must not silently create or read a shared session instead.
5. **Existing data:** app-user sessions and private files are preserved but unavailable through normal chat/session/artifact operations. They are not converted into ordinary profile sessions or shared files.

This is a breaking change for external apps and consumers of the exported client types/methods. Do not offer the local CLI token as a replacement for the removed external-app feature.

## Implementation order

### 1. Remove the dashboard surface

| Location | Change |
| --- | --- |
| `apps/web/src/components/settings/OrgApiKeysCard.tsx` | Delete the feature-only component, hook, dialogs, secret banner, environment copy, and integration prompt. |
| `apps/web/src/components/system/OrganizationPanel.tsx` | Remove the import and rendered card. |
| `apps/web/src/lib/query-keys.ts` | Remove `orgApiKeys`. |

Remove any imports or assets left unused by this deletion. Do not redesign the remaining organization page or add replacement copy.

### 2. Remove backend key management and authentication

| Location | Change |
| --- | --- |
| `apps/server/src/http/routes/org-members.ts` | Remove API-key routes, request/response schemas, contract imports, and OpenAPI registrations. Keep member routes. |
| `apps/server/src/services/org-service.ts` | Remove key CRUD/rotation, secret generation, summary conversion, and new key audit-event writes. Keep historical audit records. |
| `apps/server/src/http/shared.ts` | Remove `resolveApiKey()`, key lookup/last-used updates, and the `api-key` auth mode. Keep browser/local-token verification, including its `x-api-key` compatibility path. |
| `apps/server/src/http/org-guards.ts` | Remove checks specific to the deleted auth mode; preserve admin/viewer restrictions. |
| `apps/server/src/http/routes/auth.ts` | Remove `api-key` from auth response schemas and key-specific organization-list filtering. |
| `apps/server/src/http/org-middleware.ts` | Check assumptions about `activeOrgId` after removal. Preserve cookie/header organization selection, local-token fallback, and membership checks. |

Old key-shaped bearer secrets must never fall through to successful local-token authentication. Test rejection with a formerly valid stored key, not just a malformed token.

### 3. Remove app-user execution and client contracts

| Location | Change |
| --- | --- |
| `apps/server/src/http/routes/sessions.ts` | Remove app-user creation/list/access branches and schemas; enforce the retired-input rejection and legacy-session policy below. |
| `apps/server/src/http/routes/profiles.ts` | Remove app-user artifact selection; keep profile artifact authorization. |
| `apps/server/src/http/shared.ts` | Remove `getRequestAppUserScope()`; use existing request validation/middleware for rejecting the retired header on affected routes. |
| `apps/server/src/services/agent-service.ts` | Remove app-user session options, workspace creation, and special memory/user-context/tool-selection branches. Refuse to load or execute legacy app-user sessions. |
| `apps/server/src/services/attachment-service.ts` | Reject attachment loads belonging to a retired session, including loads by attachment ID without a session route. Keep normal and ephemeral/cognito attachment behavior. |
| `apps/server/src/services/session-persistence.ts` | Reject retired history reads/copies and persistence. Update explicit profile deletion cleanup to include retired archives despite filtered session lists. |
| `packages/core/src/soul/resolve.ts` | Remove `getAppUserSoulDir()` and `ensureAppUserSoulDir()` once no runtime callers remain. Keep normal profile resolution. |
| `packages/core/src/artifacts.ts` | Remove app-user read/write directory selection and its shared-artifact fallback. Keep ordinary artifacts and shares. |
| `packages/core/src/tools/builtin.ts`, `search-files.ts` | Remove app-user write remapping and own-user-directory exceptions after private files have been moved out of active workspaces. Preserve generic path and workspace guards. |
| `packages/core/src/contract.ts` | Remove API-key CRUD types, the auth-mode variant, and public app-user fields from session/tool contracts. |
| `packages/client/src/client.ts`, `types.ts` | Remove key CRUD methods, `forAppUser()`, client app-user state/options/header injection, and session scope forwarding introduced in #1580. Keep `forOrg()` and ordinary session creation. |

Do not remove generic `workspaceRoot` support or `buildToolExecutionContext()`: custom tools and other workflows need them. Remove only branches whose purpose is app-user isolation/execution.

The current session-creation Zod object strips unknown properties. Removing its `appUserId` definition alone will silently accept old payloads. Reject that property in the raw JSON before parsing/stripping; do not expose it in the new OpenAPI schema or make all unrelated request objects strict. Apply retired-header rejection to session creation/list/detail/mutations, attachment content, and profile artifact operations. Invalid credentials still return 401 before request validation.

Deleting the API-key integration test also removes the only current `@nakama/client` import in `apps/server`. Recheck imports, then remove that server dev dependency and update `bun.lock` if it is still unused.

### 4. Retire storage without exposing existing private data

**Keys:** remove `StoredApiKeyRecord`, database adapter key methods, prepared statements, and row conversion from `packages/db/src/types.ts` and `adapters/sqlite.ts`. Remove `api_keys` from `packages/db/sql/schema.sql` and its creation migration in `packages/db/src/migrate.ts`. Add an idempotent transactional `DROP TABLE IF EXISTS api_keys` upgrade step. Retain historical key audit events.

**Sessions:** retain the internal `sessions.app_user_id` column as a legacy marker for this removal. Any non-null value marks a retired session. It is no longer an API field or a supported session type. Keep the minimal migration that makes this marker available on older databases; fresh rows leave it null. Remove public fields, internal creation options, query parameters, and serialization.

Enforce retirement in `packages/db/src/adapters/sqlite.ts`, not just HTTP routes:

- Add `app_user_id IS NULL` to normal `getSession`, `listSessions`, `listSessionsForUser`, and `listSessionSummaries` SQL. Apply it before search, counts, sorting, and pagination so hidden rows do not affect cursors, previews, or totals.
- Message reads and session/message writes must check the parent session, including direct `listMessagesForSession` calls, todo/questionnaire reads, replacement, deletes, title/model/todo/questionnaire/pin updates, and attachment loads. Retired data must not be returned or changed. Preserve existing missing-session return conventions. Keep check-and-write in the existing SQLite transaction so message replacement cannot delete rows before discovering that the parent is retired.
- Normal inserts write a null marker. An upsert with an existing retired ID must fail without changing any row or clearing its marker; a filtered `getSession()` returning null must not allow that ID to be recreated.
- `getAttachment` must not expose rows with a retired parent; use an explicit SQL parent check, rather than treating a filtered/missing parent as an ephemeral attachment. Preserve valid null-session ephemeral/cognito attachments. Check the shared attachment loader and `/v1/attachments/:attachmentId/content` as well.
- Keep raw access to retired rows limited to existing migration, full-backup, and intentional parent-data cleanup paths. Do not add a public “include retired” API or serialize the marker to normal users.

`agent-service.ts` must also revalidate session eligibility before using cached sessions. Apply the same check to archived-history reads/copies and background execution. Ordinary user/organization exports use filtered session reads; full operator backups retain the raw database.

Dropping or clearing this marker would make private sessions indistinguishable from ordinary sessions. An automatic purge of legacy sessions/files is outside this change; existing explicit profile/organization deletion remains supported.

**Files:** move retired data out of active profile workspaces into `<NAKAMA_CONFIG_DIR>/retired-app-users/{orgId}/{profileId}/`. Preserve relative layout and bytes; do not merge private memory or artifacts into the profile root. Inventory with raw session/attachment records before filtered adapters hide them. Move:

1. The existing `users/{hash}/` subtree, including orphan user directories without a remaining session row.
2. Attachment bytes belonging to retired sessions from the shared profile `attachments/{attachmentId}` directory. These files are not stored under `users/` today.
3. Retired session-history JSONL files from the organization's `session-history/` directory.

Keep database rows and attachment metadata as retirement evidence; ordinary APIs never resolve these archived bytes. Preserve explicit existing artifact-share snapshots as already-published content; do not create new shares from retired data. Ordinary profile packs and user/org exports must not include the retirement archive. Full instance backup/restore must include it. Explicit profile/organization deletion must clean up the corresponding retirement archive, using its identifiers rather than filtered session enumeration.

Use `apps/server/src/index.ts` before agent initialization/worker recovery and the existing `apps/server/src/services/data-portability.ts` staging flow for filesystem retirement. Keep the shared routine in an existing module, with both callers passing explicit config/database roots. At startup use `getUserConfigDir()`; during restore use `stagedRoot` and the staged database path, never the current live config root. This must work with Docker volume mounts, desktop layouts, and custom config roots. Moves within the config volume must be restartable: an already-moved source is skipped, destination conflicts fail without overwrite, and any other move error prevents serving/restarting workers. A source/destination symlink must not allow traversal outside that root. Preserve private file/directory permissions. No marker is cleared because a file is missing.

Do not rely on file-tool deny lists as a shell sandbox. `apps/server/src/tools/bash.ts` host commands and custom tools run with the server's filesystem privileges. Moving files prevents normal workspace traversal and sandbox mounts from exposing them; unrestricted host tools remain trusted operator capabilities and can access operator backups. This removal does not introduce a new host sandbox or promise protection against those privileged tools.

**Upgrade/restore:** deploy as a coordinated restart with a pre-upgrade database/config backup. Stop old API processes and workers; do not mix old and new binaries on shared storage, as old migrations can recreate the key table and old workers can continue executing cached sessions.

Run database retirement and filesystem retirement before accepting traffic or starting workers. SQLite transactions cannot cover filesystem moves: keep the retained database marker authoritative and retry incomplete moves on startup. Startup must fail closed if retirement cannot finish, leaving source/archive files recoverable.

For full restores, sanitize the staged restored config/database after resolving its database layout and before `beforeReplace`, replacing live data, or setting `restoreCommitted` in `apps/server/src/services/data-portability.ts`. Reuse the existing restore staging/rollback flow for both normal restore and setup import. The current route catches failures from `onDataRestored`; a post-commit reopen hook alone is therefore insufficient. Reuse `agent.reloadAfterDataRestore()`/`refreshHarness()` for cache invalidation and verify successful completion before resuming traffic; reopening the database proxy alone does not invalidate cached sessions. Cancel/drain active turns and stop workers through existing lifecycle hooks before live replacement. If reopen/reload fails, keep the runtime unavailable until restart rather than letting the swallowed exception resume normal requests. The affected hooks/routes are in `index.ts`, `http/routes/data-portability.ts`, and `http/routes/setup-import.ts`; this is a restore gate within existing modules, not a new general migration framework.

Run upgrade and old-backup restore twice to prove idempotence. Rollback requires stopping the new runtime and restoring the previous release plus the complete pre-upgrade database/config backup. A code revert alone cannot restore dropped keys or original file locations.

### 5. Remove docs and generated references

| Location | Change |
| --- | --- |
| `docs/website/content/docs/app-backend.mdx` | Delete the external-app integration guide. |
| `docs/website/content/docs/meta.json` | Remove the `app-backend` navigation entry. |
| `docs/website/content/docs/integrations.mdx` | Remove the Backend API keys section. |
| `docs/website/scripts/postbuild.ts`, `lib/site-meta.ts` | Verify generated Markdown mirrors, routes, sitemap, and `llms.txt` derive from remaining pages and contain no retired guide. Modify only if a stale reference remains. |

Search README, contributor architecture/context notes, scripts, examples, and screenshots for feature-specific references. Change only passages about this removal; retain unrelated credential instructions. Follow `docs/website/AGENTS.md` when implementing docs changes.

Publish a short release note that backend API keys and app-user integration are removed, existing external apps stop working, and existing private data remains retained. The retired guide and `/app-backend.md` mirror must no longer advertise the feature.

## Tests and checks

Replace removed-feature success tests with behavior tests in existing suites:

1. A formerly valid Nakama key gets 401; browser login, local-token auth, org selection, and role restrictions still work.
2. Removed key routes return 404 for an authenticated admin and are absent from OpenAPI. Notification webhook credentials still work independently.
3. Normal session creation/messages/artifacts work. Removed `appUserId` payloads (including null/empty values) and retired headers get 400 with no session/file side effects. OpenAPI and client types omit these inputs.
4. Marked legacy sessions stay out of lists, search, pagination totals/cursors, and ordinary exports. Direct reads/mutations/execution return 404. DB-level message/todo/questionnaire reads reveal nothing; attempted writes/upserts leave retired rows, messages, and markers unchanged. Include a cached-session case and restore of a retired row with the same ID as a previously cached normal session.
5. Reading a known retired attachment ID returns 404 at the content route and no bytes from the shared loader. Retired session history cannot be read/copied. Normal and null-session ephemeral attachments still work.
6. Retire `users/`, retired attachments, and history into the operator archive; verify their bytes survive, normal files remain in place, normal workspace shell traversal/search cannot discover them, and full backups retain them while ordinary exports/profile packs do not. Explicit parent deletion removes its archive without touching another org/profile.
7. Fresh databases work; old databases and restored backups upgrade without losing ordinary sessions. A second upgrade changes nothing and does not recreate `api_keys`. Exercise a custom config root and staged restore roots distinct from the live root.
8. Inject move/permission failures and destination conflicts: startup serves nothing, files remain recoverable, and retry finishes without overwrite or loss. Staged restore retirement failure leaves the live installation untouched. Test interrupted moves, symlink escape refusal, and failed post-restore reload keeping the runtime unavailable; successful restore invalidates cached sessions before work resumes.

Relevant existing suites include `apps/server/src/http/app.test.ts`, `org-members.test.ts`, `platform-mfa.test.ts`, `routes/sessions.org-scope.test.ts`, `routes/profiles-artifacts-auth.test.ts`, `routes/setup-import.test.ts`, data/profile-portability tests, `services/attachment-service.test.ts`, `services/session-persistence.test.ts`, `services/agent-service.session-list.test.ts`, `packages/client/src/client.test.ts`, `packages/db/src/seed.test.ts`, and core soul/artifact/file-tool tests. Extend existing DB session suites for the SQL retirement rules. Update test adapter mocks when removing database methods.

Run:

```bash
bun run check
bun run test
bun run knip
bun run build
bun run build:docs
```

Run the repository React Doctor workflow for the UI deletion. Browser checks require an explicit request; do not add Playwright. Search for residual `forAppUser`, `X-Nakama-App-User-Id`, `NAKAMA_API_KEY`, backend key routes, and `app-backend` references. Remaining matches should be removal tests, this plan, release history, or intentional legacy-data protection.

## Done when

- UI, API, exported client surface, and published docs no longer offer backend keys or app-user integration.
- Old keys cannot authenticate; old app-user inputs cannot silently switch to shared access.
- Existing private data stays private, while normal chat, CLI, workers, and third-party credentials continue working.
- Fresh install, upgrade, restore, repository checks, and CI pass.

Deliver as one coordinated removal PR so the server, client, UI, and docs agree on the supported feature set.

## Review record

Reviewed against the current worktree and #1580's client changes. Major gaps found and resolved in this plan:

| Verified code behavior | Plan correction |
| --- | --- |
| Host `runBash()` executes commands with server privileges; file-tool guards do not cover its commands. | Archive retired files outside active workspace trees and state the trusted-host-tool boundary. |
| `readChatImageAttachment()` and `createAttachmentLoader()` authorize by org/profile, without checking a retired parent session. Attachment bytes live in shared profile storage. | Filter parent-session attachment access and retire those bytes separately from `users/`. |
| Raw DB session/message/todo/questionnaire statements do not filter app users. | Enforce eligibility at DB reads/writes, including pagination and conflicting upserts; retain the SQL marker without exposing a supported app-user type. |
| The session-creation Zod object strips unknown fields. | Reject the retired field before parsing instead of silently creating shared sessions. |
| Restore marks replacement committed before post-restore hooks, and routes can swallow hook failures. | Retire staged data before replacement, reuse existing cache invalidation, and gate runtime availability on restore success. |

Second review checked removal scope, credential separation, fresh/legacy storage, file/attachment/history access, restore/rollback, exports/deletion, and validation coverage. No unresolved major issue identified in the revised plan. Implementation still needs the checks above; this review does not claim they have run.
