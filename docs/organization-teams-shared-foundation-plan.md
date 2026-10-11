# Organization, teams, and shared resources

## Outcome

Build the Organization page shown in the reference image.
An organization supplies shared knowledge, skills, agents, tools, and models to its teams.
Each team keeps its own members, work, settings, and additional resources.

Status: plan reviewed and revised. See "Progress" at the end for implementation state.
The screenshot defines the proposed screen. Its names, counts, integrations, and models are sample data.

## Design reference

![Organization page design with shared resources, teams, and current team settings](organization-teams-shared-foundation-design.png)

## Current code

- Organizations are separate tenants. They do not currently have a parent relationship.
- `apps/web/src/pages/OrganizationPage.tsx` renders `OrganizationPanel`.
- `apps/web/src/components/system/OrganizationPanel.tsx` renders member, skill policy, memory, and archive settings.
- `OrgSwitcher.tsx` and `auth-context.tsx` already handle organization selection.
- `org-service.ts` handles organization creation, members, invitations, and archive operations.
- `org-middleware.ts` checks the active organization and membership.
- `packages/db/sql/schema.sql` stores organizations and organization memberships.
- Profiles, sessions, workspaces, and resource access already depend on organization IDs.
- Tool catalogs include global records and tenant-owned records. Current custom tool creation requires platform admin access.
- Custom tool execution rejects a different `context.orgId` and loads credentials from the executing organization.
- Skills without `profileId` use global storage. Profile skills use organization and profile directories together.
- Providers come from install-wide `UserConfig`. Stored model selections use `providerId::modelId`.
- Knowledge search uses attached organization documents, profile documents, and a separate profile memory backend.
- `resolveSession()` reuses cached sessions until plugin revisions change. Ephemeral sessions keep their history only in memory.
- `cloneProfile()` copies soul files, knowledge, and assignments within one organization. It cannot create a safe shared instance unchanged.

Do not replace this tenant system or rename database tables to match screen labels.

## Proposed decisions

These decisions are implementation assumptions. The image does not define access rules or resource update behavior.

1. Keep existing organizations as tenant records. Add an optional `parentOrgId` to represent the organization above each team.
2. Support one parent level. A parent cannot itself belong to another parent.
3. Show a child tenant as a **Team** in this screen. Keep its existing `org_id` for requests and stored data.
4. Keep existing standalone organizations working without a parent. Do not link tenants automatically during migration.
5. Share only resources that a parent admin explicitly publishes. Existing parent data stays private by default.
6. Make published resources available to every active child team. Keep profile assignments and execution permissions separate from availability.
7. Allow teams to add local resources. Do not let teams overwrite a shared resource through a matching name.
8. Keep team chats, files, memories, credentials, automations, and usage records private to that team.
9. Preserve existing global resources as global. Publications add parent resources; they do not remove existing global access.
10. Let an existing root organization become a parent when its admin creates its first team. Keep existing root work in that tenant.

No new package, dependency, general permission engine, or unlimited organization tree is needed.

## Access rules

| Actor | Read access | Change access |
| --- | --- | --- |
| Parent admin | Parent catalog and all team summaries | Parent publications, team creation, and first team-admin assignment |
| Team admin | Published parent catalog and permitted team summaries | Own team members, settings, and local resources |
| Team member | Published catalog and existing permitted team actions | Existing member actions only |
| Team viewer | Published catalog and existing permitted read actions | No new write actions |
| Unrelated user | No parent or team access | None |
| Platform admin | Existing platform authority | Existing platform authority |

Parent membership does not automatically grant access to a team's chats or files.
Team membership does not grant access to private parent resources.
Show sibling team names and counts only to users who already have membership there, or parent admins.
Selecting a team requires existing team access. A list row does not grant membership.
The team-creation form defaults its first admin to the creator, using that user's existing account.
A creator who selects another existing user does not receive automatic team membership.
Keep the current parent selected after creation. Offer team switching only when the creator has team access.

## Shared resource behavior

| Resource | Proposed behavior | Required boundary |
| --- | --- | --- |
| Knowledge | Include published parent documents in team catalogs and search | Check publication before search, document reads, and downloads |
| Skills | Publish selected skills owned by parent profiles; include them in team profile assignments | Team users cannot edit the parent source |
| Agents | Use published parent profiles as templates for team-owned agent instances | Sessions, memory, files, and execution context belong to the team |
| Tools | Include published tools in the available tool catalog | Keep role checks, approvals, and credential rules during execution |
| Models | Publish references to configured global provider instances and their models | Keep platform provider management, server-held keys, and team usage limits |

Use live publication checks for knowledge, skills, tools, and models.
Parent changes affect the next resource read or agent turn. Do not promise cancellation of an already running call.

Shared agents need local instances because current execution depends on the profile's tenant.
Create each instance on first selection, with a unique team and source-profile relationship.
Copy only agent configuration and permitted assignments. Do not copy history, memory, credentials, or workspace files.
Keep template configuration read-only in the team. Apply parent configuration updates before the next turn.
Preserve team memory and sessions during updates. Block new turns when the source publication is removed.
Publish only explicit agent identity, style, instructions, model choice, and permitted assignments.
Read published soul configuration into prompt composition. Keep team memory and user context in the local soul stack.
Do not copy arbitrary source files or use `cloneProfile()` to bypass source tenant checks.
Reject publication when the template requires unpublished tenant resources or unsupported parent MCP connections.
Block team edits to template-owned fields through profile, soul, assignment, clone, and import APIs.
Keep local agents separate. Do not silently convert a shared instance into a local agent.
Exclude Super Bot and the built-in Default Bot from publication.

Availability does not automatically assign every tool or skill to every agent.
Use existing profile assignment controls. Reject assignments that the source publication no longer permits.
Keep personal OAuth connections tied to the signed-in user and team.
Do not reuse parent integration credentials without an explicit supported shared connection.
Show unavailable connections as requiring setup. Do not mark them ready merely because the tool was published.
Keep custom tool definitions under platform administration. Team admins may assign permitted tools and configure their own credentials.
For the Tools row, include existing MCP and Composio integration summaries where the existing catalog exposes them.
Share integration availability only. MCP servers with embedded parent credentials require a team-local connection before execution.

Keep model references as `providerId::modelId`, since equal model names can exist under different provider instances.
Parent and team admins select configured models; platform admins retain control of provider keys and provider creation.
Publication removal blocks use only when no other valid access source remains, including existing global access.
Do not introduce model allowlists that restrict existing tenants as part of this feature.

Stable IDs resolve catalog collisions, but executable tools and skills also use names.
Reject conflicting profile assignments and invalid shared templates before execution. Do not silently shadow a same-name resource.

## Implementation sequence

### 1. Add the tenant relationship and publication records

- Extend `packages/db/sql/schema.sql`, `packages/db/src/migrate.ts`, types, and SQLite adapter methods.
- Add nullable `parent_org_id`, a parent lookup index, and a foreign key that blocks parent deletion with children.
- Add an idempotent migration. Leave existing IDs, paths, memberships, and resource ownership unchanged.
- Validate parent existence, active status, depth, and self-link rejection in `OrgService`.
- Store explicit publication records with parent ID, resource kind, and stable resource ID.
- Validate each resource through its existing store. Some resources use filesystem storage rather than SQL ownership.
- Add stable source links for team agent instances. Enforce uniqueness for each team and published source profile.
- Keep schema changes and team creation within transactions where SQL controls the operation.
- Use existing workspace setup and cleanup handling for operations that also create files.
- `createOrganization()` currently inserts and seeds before adding its admin. Do not assume this sequence is atomic.
- Validate the first admin before writes. Add child-specific compensation for failed seeding or membership creation.
- Delete only the failed child's new rows and files. Preserve existing user accounts and parent resources.
- Serialize child creation against parent archive. Recheck parent activity inside the database write boundary.
- A failed or retried request must not leave a child without an admin or create duplicate teams.
- Add request idempotency for child creation and retain its result until the client can recover after a network failure.

### 2. Extend contracts and organization routes

- Update `packages/core/src/contract.ts` and existing OpenAPI schemas together.
- Extend existing organization route registration and `OrgService`; avoid a separate hierarchy service.
- Add proposed `GET /v1/orgs/:orgId/overview`, where `orgId` is the active root or team tenant.
- Derive the parent from that tenant on the server. Return its public overview without granting general parent membership.
- Add proposed `POST /v1/orgs/:orgId/teams` for parent admins to create a child and its first team admin.
- Add proposed publication list, publish, and unpublish operations under `/v1/orgs/:orgId/shared-resources`.
- Keep shared template summaries separate from `ListProfilesResponse`; a parent profile ID is not a usable team profile ID.
- Add proposed `POST /v1/orgs/:orgId/shared-agents/:publicationId/instance` in team context, returning the normal team `ProfileResponse`.
- Require existing permission to invoke agents. Resolve the publication server-side and return the existing instance on repeated selection.
- Open chat only after instance creation succeeds. Refresh the team profile query before selecting the returned profile ID.
- Validate path IDs against request organization context. Never trust a client-supplied parent ID for resource access.
- Team users request overview with their team ID and `X-Org-Id`. They must not send the parent ID through ordinary tenant middleware.
- Parent management requests require parent context and parent admin membership, or existing platform admin authority.
- Keep mutation authorization separate from overview access. `orgRole` for a team never proves parent authority.
- Route shared resource details through the authorized active tenant; do not link users to inaccessible parent-only endpoints.
- Return resource IDs, labels, source organization, and readiness state. Do not return secrets or private paths.
- Calculate member counts and local additions from stored data. Avoid one HTTP request per team or resource chip.
- Preserve existing membership and active-organization APIs for team switching.
- Reject parent archive while active children remain. Reject parent deletion while any child remains.
- Do not include reparenting or automatic attachment of existing tenants in this release.
- Use the existing root as the parent setup entry. Its Organization page exposes publication controls and **Add team** to permitted admins.
- Add explicit publish and unpublish controls using existing resource selectors. Show failure and retry without changing the current catalog.
- Prevent new publication when its source tenant or resource is archived, deleted, or inaccessible.
- Invalidate dependent publication entries when their source is deleted. Existing global resources remain available through global access.

### 3. Connect publication checks to real resource use

- Extend knowledge catalog, search, read, and download paths in `packages/core/src/knowledge-base/` and `profile-service.ts`.
- Pass authorized parent document references from server resolution into the core catalog and search paths.
- Keep the core package independent of server services. Use the existing tool context callback for server-owned publication checks.
- Search only published parent document IDs through both regex and indexed search paths; never search the complete parent directory.
- Keep existing local document attachment behavior. Add published parent documents as a separate readable scope with source identifiers.
- Keep profile memory backend results scoped to the team. Check extracted-file paths and symlinks against the authorized source directory.
- Extend `skills-service.ts` discovery, assignments, and prompt composition with published parent skills.
- Publish parent profile skills by stable ID. Do not create a parent skill through the existing global skill write path.
- Load skill tool files and supporting assets from authorized source directories while keeping execution context in the team workspace.
- Keep shared sources read-only through skill management, curator jobs, proposals, post-turn review, and archive operations.
- Extend profile listing and selection with published agent templates and team-owned instances.
- Update `agent-service.ts` configuration, tool, skill, and model resolution before each new turn.
- Extend existing session capability revision checks with parent publication and template revisions.
- Rebuild persisted sessions only between turns, after saving history. Preserve session IDs, stored messages, and pending state.
- For ephemeral sessions, reuse the existing cognito model-change rebuild path with `getHistory()` passed as `initialHistory`.
- Preserve ephemeral user context and pending state. Replace the session only after the new configuration succeeds, between turns.
- `AgentChatSession` has no configuration setter; changing only `resolvePromptContext` cannot refresh its captured tools or provider.
- If refresh fails, retain history and report a retryable error. Do not run a new turn with revoked capabilities.
- Check publication at each shared tool invocation, even when a cached session still holds the tool definition.
- Apply model checks to session overrides and auxiliary model calls, including vision processing, when they use published references.
- Keep `buildToolExecutionContext()` rooted in the team profile workspace.
- Apply identical checks to direct API calls, tool playground runs, CLI calls, channel workers, and automation runs.
- Preserve model capability validation and existing provider selection. Reject a removed model instead of silently changing providers.
- Charge model usage to the executing team. Do not combine team histories or quotas.
- Preserve stable IDs when names collide. Show source labels where a local and shared resource have equal names.
- Refresh affected catalogs after publish, unpublish, rename, and delete operations.
- Recheck publication at execution. Cached catalog entries cannot grant access after removal.
- Update custom tool authorization to accept a valid parent publication without changing `context.orgId` to the parent.
- Keep credential lookup under the executing team. Publication grants code access, not parent secret access.

### 4. Build the Organization screen

- Extend `OrganizationPage.tsx` and `OrganizationPanel.tsx` with the reference layout.
- Show the parent name above a **Shared with every team** card.
- Render Knowledge, Skills, Agents, Tools, and Models as five rows with real resource chips.
- Link chips to permitted resource details or setup. Do not make decorative chips look actionable.
- Show a Teams card with **Add team**, real member counts, local additions, and a **Current** badge.
- Use the existing active organization ID to identify the current team.
- Show team details on row selection. Switch active teams only when the user chooses a permitted team.
- Keep existing member, invitation, skill policy, memory, and archive controls under **Current team settings**.
- On a root tenant, keep these controls under **Organization settings** until the user switches to a team.
- Keep the existing team ID and copy action. Add accessible names to icon-only controls.
- Reuse existing cards, buttons, badges, dialogs, and icons.
- Keep headings sufficient. Add no general helper subtitles unless an access rule needs explanation.
- Wrap resource chips on small screens. Keep rows usable with a keyboard.
- Show loading, empty, request failure, retry, and submitting states.
- Hide admin actions from other roles. Enforce the same rules on the server.

### 5. Update client state and compatibility

- Extend `packages/client/src/client.ts` with the new typed operations and explicit organization scope.
- Add overview query keys in `apps/web/src/lib/query-keys.ts` using both parent and active team IDs.
- Reuse the query and mutation patterns in `use-org-members.ts`.
- Extend `auth-context.tsx` only where parent display data is needed. Keep membership roles tied to their own tenant.
- Update `OrgSwitcher.tsx` labels where team context applies. Do not change unrelated navigation from the image alone.
- Clear sensitive cached data on sign-out and account changes.
- Invalidate overview and resource queries after changes. Prevent late responses from replacing a newly selected team's data.
- Preserve standalone organization settings and existing client response fields.
- Review import, export, clone, archive, and restore paths for parent links and publication metadata.
- Reject imports that would introduce foreign parent links or publications without permission.
- Existing tenant exports remain tenant-local. Exclude parent secrets and unpublished source files from child exports.
- Import shared agent instances as inactive references until the destination can verify the same publication; preserve exported conversation data.
- Invalidate shared revisions after source restore. Do not automatically republish deleted or previously unpublished resources.

## Tests and completion checks

1. Migrate a populated database twice. Confirm stable IDs, unchanged memberships, and no implicit shared resources.
2. Test team creation, invalid parents, self-links, nested parents, unauthorized creation, and failed workspace setup.
3. Test parent and team archive rules. Preserve existing last-organization and last-admin protections.
4. Test all five resource types with two sibling teams and one unrelated organization.
5. Confirm sibling private resources, chats, files, credentials, and memories remain inaccessible.
6. Confirm direct resource IDs cannot bypass publication checks, including document downloads and tool execution.
7. Confirm publication removal blocks new use through HTTP, CLI, channels, and automations.
8. Confirm shared agent creation is idempotent and concurrent selection creates only one local instance.
9. Confirm parent agent updates preserve team memory and sessions. Confirm all execution paths use the team workspace.
10. Confirm team quotas, viewer restrictions, approval rules, and personal OAuth ownership remain effective.
11. Test real counts, role gates, chip wrapping, keyboard actions, retries, and current-team selection in component tests.
12. Confirm standalone organizations still use their existing settings and switching behavior.
13. Run focused tests, affected package type checks, `bun run check`, and `bun run knip`.
14. Run the repository test suite before release. Build the changed web and server packages.
15. Request overview as a team member without parent membership. Confirm success, filtered team summaries, and denial of parent mutations.
16. Create the first team from a root tenant. Confirm publication controls, first-admin assignment, and permitted switching work together.
17. Inject failures after child insertion, profile seeding, and admin assignment. Retry the same request and confirm one complete child.
18. Race parent archive against child creation. Confirm no active child can have an archived parent.
19. Revoke resources in a cached persisted session and an ephemeral session. Confirm new calls are blocked and history remains intact.
20. Test global resource compatibility, tool credential isolation, duplicate executable names, and read-only shared skill maintenance.
21. Test indexed and regex parent document search, downloads, source deletion, and denial of unpublished document IDs.
22. Test equal model names under different provider instances, session overrides, and vision use without exposing provider keys.
23. Test shared template identity and style updates, source deletion, export/import, and attempts to edit template-owned fields.
24. Select a shared template through the client. Confirm returned IDs belong to the team and chat opens after profile queries refresh.

Browser checks require an explicit request under repository rules. Do not add Playwright for this feature.
Tests must assert access, returned data, and side effects rather than exact copy.

## Delivery order

1. Deliver schema, contracts, access rules, and migration tests.
2. Deliver all five resource paths and execution checks.
3. Deliver the Organization page, client state, and component tests.
4. Document the UI path and roles in existing user docs. Build docs if changed.

Do not label resources **Available to all teams** until their actual use passes the access tests.
Record related work against a feature issue before implementation, as required by `CONTRIBUTING.md`.
Feature issue: [#1765](https://github.com/ahmadrosid/nakama/issues/1765), assigned to `ahmadrosid`, with `stage: now`.

## Limits and risks

- This plan proposes parent relationships and publication semantics. The image alone cannot verify those product decisions.
- Providers remain install-wide; this feature shares selections, not tenant-owned provider keys.
- Integrations still need team-local connections. The plan does not authorize parent credential delegation.
- Shared agents require configuration synchronization; this is the largest part of the change.
- Skip nested teams, reparenting, per-team publication exceptions, shared chat history, and unrelated sidebar changes.
- No product code changed. No tests or browser checks ran for this planning task.

## Review record

The review checked tenant middleware, organization creation, catalogs, custom tool execution, skill paths, provider selection, soul composition, and session caching.
The revised review checked each gap against the same source paths and the screenshot's five resource rows.
Major gaps addressed: team-context overview access, root setup, partial creation, global resource compatibility, and executable name collisions.
It also addressed shared skill writes, agent identity, cached-session updates, source deletion, and tenant-local credentials.
Remaining product assumptions are the single parent level, explicit publication, filtered sibling visibility, and managed shared agent instances.
These are stated choices, not verified requirements from the screenshot.

## Progress

Implementation sequence:

- [ ] 1. Add the tenant relationship and publication records.
- [ ] 2. Extend contracts and organization routes.
- [ ] 3. Connect publication checks to real resource use.
- [ ] 4. Build the Organization screen.
- [ ] 5. Update client state and compatibility.

Delivery order:

- [ ] 1. Deliver schema, contracts, access rules, and migration tests.
- [ ] 2. Deliver all five resource paths and execution checks.
- [ ] 3. Deliver the Organization page, client state, and component tests.
- [ ] 4. Document the UI path and roles in existing user docs.

2026-10-11: First iteration stopped at the required feature-issue gate. GitHub searches found no matching feature issue.
Searches covered shared foundation, team organization, shared issue titles, teams issue titles, and parent organization.
No implementation slice started. No tests or commits ran. Next: provide the feature issue before the schema slice.
The issue gate remained unmet on three consecutive goal turns. Implementation is blocked until a matching feature issue is supplied.

2026-10-11: Created issue #1765 after the user requested it. The issue gate is resolved; work stays on `main` as requested.
Slice 1a adds the nullable parent column, foreign key, self-link rejection, index, and repeatable migration tests.
Checks: `bun test packages/db/src/migrate.test.ts` passed (37 tests); `bun x ultracite check` passed (1532 files).
The database type check failed twice. A temporary config extends root settings and includes all database source and tests.
Command: `bun apps/web/node_modules/typescript/bin/tsc --project /tmp/nakama-db-typecheck.json --noEmit`.
The final check reported 48 existing errors, including SQLite generic arguments, nullable rows, and stale test types.
A separate copy using `HEAD` versions of changed files produced the same 48 diagnostics after path and line normalization.
No new type errors appeared. The required passing type gate remains unmet, so this iteration stops without a commit.
The schema slice remains uncommitted. Next: resolve existing database type errors before completing slice 1a and continuing adapter work.

2026-10-11: Slice 1a completed after fixing the existing database type errors in the second code repair attempt.
Fixes preserve JSON validation, add missing SQL binding types, check missing write results, and correct stale test types.
Checks: all 145 database tests passed; the database type check passed; `bun x ultracite check` passed.
Type check config extends root `tsconfig.json`, includes `packages/db/src/**/*.ts`, and uses `ESNext`, `DOM`, and root `node_modules/@types`.
Next slice: persist and read `parentOrgId` through the adapter; reject parent archive and deletion with children.

Status values: `todo`, `doing`, `done`, `blocked`.

| ID | Delivery stage | Step | Test items | Status | Commit | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1. Schema, contracts, access | Tenant relationship and publication records | 1, 2, 3, 17, 18 | doing | ae7404d0 (1a), 47c456c3 (1b), 69fdbb59 (1c), ff81645b (1d) | Slices 1a–1e complete; team creation work remains |
| 2 | 1. Schema, contracts, access | Contracts and organization routes | 15, 16 | todo | | |
| 3a | 2. Resource paths | Knowledge | 4, 5, 6, 21 | todo | | |
| 3b | 2. Resource paths | Skills | 4, 5, 20 | todo | | |
| 3c | 2. Resource paths | Agents | 8, 9, 19, 23, 24 | todo | | |
| 3d | 2. Resource paths | Tools | 6, 7, 10, 20 | todo | | |
| 3e | 2. Resource paths | Models | 10, 22 | todo | | |
| 4 | 3. Page, client, component tests | Organization screen | 11, 12 | todo | | |
| 5 | 3. Page, client, component tests | Client state and compatibility | 12, 24 | todo | | |
| 6 | 4. Docs | Docs in `docs/website/content/docs/` | | todo | | |
| 7 | Release | Final checks (items 13, 14) and PR | 13, 14 | todo | | |

Slice log (one row per commit):

| Date | Step ID | Change | Tests added | Next |
| --- | --- | --- | --- | --- |
| 2026-10-11 | 1a | Parent schema and idempotent migration; repaired existing database type errors | Fresh and upgrade migration, reference constraints; 145 database tests passed | Parent adapter persistence and archive guards |
| 2026-10-11 | 1b | Persist parent relationships; reject reparenting, nested teams, inactive parents, unsafe archive and deletion | Lookups, memberships, ordinary updates, lifecycle guards; 147 database tests passed | Publication records and migration |
| 2026-10-11 | 1c | Publication and shared agent source-link tables; repeatable migration | Five resource kinds, uniqueness, references, revocation survival, cleanup; 149 database tests passed | Publication adapter operations |
| 2026-10-11 | 1d | Scoped publication reads and writes; idempotent publish; SQL ownership checks and source-deletion triggers | Active root, wrong scope, retry, default/Super Bot rejection, SQL ownership and deletion; 151 database tests passed | Agent source-link operations and atomic team creation |
| 2026-10-11 | 1e | Atomic shared agent profile/source-link creation; scoped reads and explicit reconnection | Concurrent selection, sibling isolation, revocation, retained sessions, source deletion, injected rollback; 154 database tests passed | Atomic team creation and request idempotency |

2026-10-11: Slice 1b passed database tests, the database type check, and `bun x ultracite check`.
The first test run found an incorrect SQL value count. The repaired query passed all database tests.
A later lint check required a simpler condition. The formatter fixed it, and the check passed.
The parent check runs inside the organization write transaction. Archived teams cannot become active under an archived parent.
Parent deletion returns false before deleting dependent resources when any child remains.
Stage 1 remains incomplete. Next: publication records and migration.

2026-10-11: Slice 1c adds explicit publication records and unique team/source agent links.
The migration leaves publications empty for existing tenants and preserves rows across repeated runs.
Publication removal and source-profile deletion retain local instances and their source links.
The first test run exposed existing default-profile migration behavior. Explicit fixture defaults corrected the test.
Checks: 149 database tests passed; database type check passed; `bun x ultracite check` passed.
Stage 1 remains incomplete. Next: publication adapter operations and source validation.

2026-10-11: Slice 1d adds publication operations to the existing database adapter.
Writes check active root status and SQL source ownership inside one transaction.
Agent publication excludes default and Super Bot profiles. Skill publication excludes disabled and foreign skills.
Global tools keep global access. Publication removal does not delete source resources.
Deletion triggers invalidate agent, skill, and tool publications, including when foreign-key enforcement is disabled.
Knowledge-file validation, configured-model validation, profile skill paths, and agent dependencies remain for OrgService.
The type check found an invalid skill creator fixture. A typed `human` fixture fixed it.
Checks: 151 database tests passed; 10 focused tests passed after the fixture repair; database type check and `bun x ultracite check` passed.
Stage 1 remains incomplete. Next: agent source-link operations and atomic team creation.

2026-10-11: Slice 1e adds atomic shared agent record creation using the existing profile writer.
An immediate transaction checks the active team, parent, publication, and source before creating a local profile and source link.
Repeated selections return the same local profile. Explicit selection after republication reconnects its link without replacing sessions.
SQL creation copies profile configuration only. Service code must still validate and assign permitted resources, create local workspace files, and enforce template edit restrictions.
A deletion trigger cleans local instance links even when test adapters disable foreign keys.
Two test repairs corrected session API use and empty-session summary assumptions. No failed check remains.
Checks: all 154 database tests passed; database type check and `bun x ultracite check` passed.
Stage 1 remains incomplete. Next: atomic team creation and request idempotency.
