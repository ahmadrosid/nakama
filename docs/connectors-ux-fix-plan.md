# Connectors UX fix plan (PR #1643)

## Goal

Make **Control center → Integrations → Connectors** easy to understand. Remove duplicate, dead, and empty entries. Old links must continue to work.

## Decision

The **Connectors** page replaces the **Composio** section. It shows the Composio content directly, so it is not only a list of links.

- Remove the **Composio** row from Control center. **Connectors** takes its place.
- Do not show **Meta Ads** until Meta OAuth works.
- Do not link to **MCP** from Connectors. Platform admins already open MCP from **Agent tools**, and the MCP page (`McpTab`) has no back link.

This removes the duplicate row, the dead row, the extra click, and the broken back navigation together.

## Steps

### 1. Make Connectors the Composio entry

File: `apps/web/src/lib/navigation.ts`

1. In `INTEGRATION_SECTIONS`, change the `composio` entry to `id: "connectors"`, `label: "Connectors"`. Keep the role rule that the old `composio` entry used: platform admin, org admin, or member.
2. Give the entry its own icon. `Plug01Icon` is already used by MCP.
3. Update the uses of `"composio"` as an **integration section id** only: `visibleIntegrationSections` and `resolveSection` / `IntegrationSectionPanel` in `IntegrationsPage.tsx`. Do not rename the other `"composio"` values: query keys in `query-keys.ts` and the profile `kind: "composio"` in `pages/profiles/` are not section ids.
4. In `resolveSection`, map the legacy value `composio` to `connectors`. The Composio OAuth callback (`apps/server/src/http/routes/composio.ts`) sends the user to `/integrations?section=composio&connected=<toolkit>`. That URL must open Connectors and keep the `connected` param, so the connection result still shows. Do not change the server URL in this PR; the redirect covers it.

File: `apps/web/src/pages/CustomizePage.tsx`

1. Remove the hand-written Connectors row that the PR added. The row now comes from `visibleIntegrationSections`, so the role logic stays in `navigation.ts`, where it can be tested.
2. Remove the `canAccessIntegrationsPage` and `Plug01Icon` imports if nothing else uses them.

Result: one **Connectors** row, with an icon that no other row uses.

### 2. Show the Composio content on the Connectors page

File: `apps/web/src/pages/IntegrationsPage.tsx`

1. Delete the `ConnectorsPage` component.
2. In `IntegrationSectionPanel`, render the current Composio panel (`ComposioSettingsCard` for platform admins, `ComposioConnectionsCard` for members) for the `connectors` section.
3. The page heading comes from `selected.label`, so it shows "Connectors". The back link already goes to Control center, which is correct.

File: `apps/web/src/App.tsx`

1. Remove the `ConnectorsPage` lazy import and the `/customize/connectors` route. After step 1, nothing links to it, and the Control center row links to `/customize/connections/connectors`, the same pattern as the other sections.
2. Old bookmarks to `/customize/connections/composio` must continue to work. Today that path falls through to `<Navigate to="/customize" />` in `IntegrationsPage`, because no section has the id `composio`. Add a static route `/customize/connections/composio` → `<Navigate replace to="/customize/connections/connectors" />` before the `:section` route.
3. Search for other links to the old path and update them: `rg 'connections/composio' apps docs`.

### 3. Hide Meta Ads

1. Do not add a Meta Ads row in this PR.
2. Remove the Meta Ads line from `docs/website/content/docs/integrations.mdx`.
3. Add the row in the PR that adds Meta sign-in. That PR must also add a connection state (`Not connected`, `Connected`, and so on), so the row is never a dead row.

### 4. Fix the docs

File: `docs/website/content/docs/integrations.mdx`

1. Change the path to **Control center → Integrations → Connectors**.
2. In the section list, rename **Composio** to **Connectors** and keep the link to the Composio doc.
3. Do not add a second line that only says who can open the page. The role rule is the same as the old Composio rule.

File: `docs/website/content/docs/composio.mdx`

1. Replace each **Control center → Integrations → Composio** with **Control center → Integrations → Connectors**. There are 5 of them (lines 29, 41, 65, 88, 98). Find them with `rg 'Integrations → Composio' docs`.
2. In `docs/meta-ads-connectors-plan.md` (added by this PR), change the route `/customize/connectors` to `/customize/connections/connectors`.
3. Check the screenshots `composio-*.png`. If they show the page heading "Composio", capture them again with `docs/website/scripts/capture-*.sh`.

### 5. Viewer access: no change

A viewer does not see the row. If a viewer opens the URL, they are sent to `/customize`. This is the same behavior as the other Integrations sections, so do not change it in this PR.

## Tests

File: `apps/web/src/lib/navigation.test.ts`

1. `visibleIntegrationSections` returns `connectors` for a member and an org admin, and does not return `composio`.
2. `visibleIntegrationSections` does not return `connectors` for a viewer.
3. A platform admin sees `connectors`.

Check routes with a short manual check (the browser check is not required):

1. The Control center row opens `/customize/connections/connectors`.
2. `/customize/connections/composio` redirects to Connectors.
3. `/integrations?section=composio&connected=github` redirects to Connectors and keeps `connected=github`. This is the Composio OAuth return path, so a failure here breaks sign-in feedback.

Assert ids and routes. Do not assert copy.

## Checks

```bash
bun test apps/web/src/lib/navigation.test.ts
bun x ultracite check apps/web/src/App.tsx apps/web/src/lib/navigation.ts apps/web/src/pages/CustomizePage.tsx apps/web/src/pages/IntegrationsPage.tsx docs/website/content/docs/integrations.mdx docs/website/content/docs/composio.mdx
bun run knip
```

Update the PR screenshots: Control center (after) and the Connectors page. Update the PR body. It must not say that Meta Ads status is shown.

## Done when

- The Integrations card has one Connectors row and no Composio row. No 2 rows have the same icon.
- The Connectors page shows the Composio content. It has no dead rows.
- Old Composio URLs open Connectors, including the OAuth return URL with `connected`.
- The docs path and section list match the UI, in `integrations.mdx` and `composio.mdx`.
