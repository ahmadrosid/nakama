# Platform admin agent search across organizations

## Outcome

Cmd+K shows agents from every active organization to a platform admin. Each result shows its organization. Selecting an agent opens a usable chat in that organization.

Other users see only agents from their active organization. This is an implementation plan only.

## Current path

- `CommandPalette.tsx` gets agents from `useSelectProfile()`, which reads the active organization's profiles.
- `client.listProfiles(orgId)` already sends `X-Org-Id`. The server permits platform admins to read profiles in other active organizations.
- `useProfilesQuery(orgId)` uses the ID only in its query key. Its request still reads the active organization, so it cannot load remote agents as written.
- `POST /v1/auth/active-org` requires membership in `OrgService.setActiveOrg`.
- `OrgService.resolveActiveOrgId` also accepts only membership organizations. It can undo a successful cross-organization switch when the auth response is built.
- `AuthProvider.activeOrg` resolves only from `listUserOrgs`. Chat and profile queries need a valid `activeOrg.id` after the switch.
- `ProfileAvatar` loads uploaded images through a URL without an organization header. An image from another organization uses the current session organization.
- `useSelectProfile()` and the active chat profile store use the current organization. Calling the old selection callback just after `switchOrg()` can lose the selected agent.

## Plan

1. Update `OrgService.setActiveOrg` and `resolveActiveOrgId` together. Read platform admin status from the stored user. Permit that user to select any existing, active organization. Keep membership checks for other users. Reject archived organizations. Preserve a valid admin session organization in the auth response.
2. Keep `listUserOrgs` and `UserOrgSummary` as real memberships. Do not give an unjoined organization a made-up role. Load the existing platform organization list for platform admins in `AuthProvider`. Resolve `activeOrg` from that list when membership is absent, with an optional role in the auth context type. Check role gates and show the active organization in `OrgSwitcher` even without memberships. Update `AuthProvider.updateOrg` and `archiveOrg` to handle an unjoined active organization. Delay the protected platform request during required MFA enrollment. If it later fails, keep the user signed in and offer retry.
3. When a platform admin opens Cmd+K, load profiles for active organizations with the existing `client.listProfiles(orgId)`. Show Super Bot and the built-in Default Bot only from the active organization. A renamed agent that holds the default role stays searchable in other organizations. Do not reuse `useProfilesQuery(orgId)` without fixing its request. Limit concurrent requests. Keep each result with its organization ID and name. Keep the current profile query for other users. Show loading and request errors, with retry for failed organizations. Do not present a partial result as the full list or show "No matching page or agent" while results are still loading.
4. Filter by agent name and organization name. Show the organization beside each agent and use both IDs as the result key. Use the existing hash avatar for agents in another organization, since their uploaded avatar URL has no organization scope.
5. For an agent in another organization, await `switchOrg(orgId)`, then open a new chat with that agent through `buildNewChatPath(profileId)`. Ensure chat state reads the requested agent after the new organization's profiles load. Do not call a selection callback captured before the switch. Keep the palette open on switch failure and show the error. Keep current selection behavior for agents in the active organization.
6. Clear or refetch search results when the signed-in user changes. Keep organization IDs in query keys so cached results cannot move between organizations. Close the palette only after navigation succeeds.

## Checks

- Service and route tests: an admin can switch to an active organization without membership, including when the admin has no memberships. The auth response and a later `getMe` keep that organization. A regular user cannot switch. An archived organization is rejected.
- Web tests: an admin sees agents from two organizations, including one without membership. Only the active organization's Super Bot and built-in Default Bot appear. A remote renamed default agent stays visible. Equal agent names show distinct organizations. Selecting a remote agent keeps the chosen organization and agent after the chat loads.
- Web tests: a regular user sees only the active organization's agents. Loading and failed requests do not show a false empty result. Remote results do not request an uploaded avatar under the wrong organization. An admin without memberships sees the active organization and can use its platform actions. Required MFA enrollment can still load auth state.
- Run focused tests, web and server type checks, and `bun x ultracite check` after implementation.
