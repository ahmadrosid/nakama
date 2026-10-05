# Connectors UX fix plan (PR #1643)

## Goal

Make **Control center → Integrations → Connectors** easy to understand. Remove duplicate and dead entries. Keep the Composio and MCP routes as they are.

## Decision

Make **Connectors** the single entry point for external account connections:

- Remove the direct **Composio** row from Control center.
- Do not show **Meta Ads** until Meta OAuth works.

If the team wants to keep the Meta Ads row, use step 2B instead of step 2A.

## Steps

### 1. Remove the duplicate Composio row

File: `apps/web/src/pages/CustomizePage.tsx`

1. In the Integrations section, filter `composio` out of `visibleIntegrationSections(...)` when the Connectors row is shown.
2. Give Connectors its own icon. `Plug01Icon` is already used by Composio and MCP. Use a link or connection icon from `hugeicons-react`.
3. Do not change `INTEGRATION_SECTIONS` in `apps/web/src/lib/navigation.ts`. `/customize/connections/composio` must continue to work for old links.

Result: one row with a plug icon in the Integrations card.

### 2A. Hide Meta Ads (recommended)

File: `apps/web/src/pages/IntegrationsPage.tsx` (`ConnectorsPage`)

1. Remove the Meta Ads row.
2. Remove the Meta Ads line from `docs/website/content/docs/integrations.mdx`.
3. Add the row again in the PR that adds Meta sign-in.

### 2B. Keep Meta Ads, but make its state clear (alternative)

1. Make the row look disabled: muted label, no hover, `aria-disabled="true"`.
2. Show a status badge (`Unavailable`) in the same style as the Composio connection status.
3. Do not add helper copy (AGENTS.md rule).

### 3. Make the rows the same as Control center rows

File: `apps/web/src/pages/IntegrationsPage.tsx` (`ConnectorsPage`)

1. Use the same row markup as `CustomizePage`: icon on the left, label, `ArrowRight01Icon` chevron on the right.
2. Replace the "Manage" text with the chevron.
3. Wrap the list in `Card` / `CardContent` and use `nav`, as `CustomizePage` does.
4. Add the focus-visible outline classes from the `CustomizePage` rows.

If both pages need the same row, move the row JSX to a small shared component. Do this only after the rows are identical (AGENTS.md: no new abstraction for one call site).

### 4. Fix the back navigation

Files: `apps/web/src/pages/IntegrationsPage.tsx`, the MCP page

1. In the links from Connectors, add `?from=connectors` (or `state={{ from: "connectors" }}`).
2. On the Composio section page and the MCP page, read the value. When it is present, show "← Back to Connectors" and link to `/customize/connectors`.
3. Otherwise, keep "← Back to Control center".

### 5. Fix the docs

File: `docs/website/content/docs/integrations.mdx`

1. Change the path to **Control center → Integrations → Connectors**.
2. Move Composio under Connectors in the section list, so the docs show the same structure as the UI.
3. Remove the Meta Ads line (step 2A), or move it under Connectors (step 2B).

### 6. Viewer access (low priority)

`ConnectorsPage` sends viewers back to `/customize` without a message. This is the same as `IntegrationsPage`, so keep it. Change both pages together only if we decide to show a "no access" state.

## Tests

File: `apps/web/src/lib/navigation.test.ts` (or a `CustomizePage` test if one exists)

1. A member sees Connectors, and does not see a separate Composio row.
2. A viewer sees neither Connectors nor Composio.
3. `/customize/connections/composio` still resolves for a member.
4. A platform admin sees MCP on the Connectors page. A member does not.

Assert the routes and visible items. Do not assert copy.

## Checks

```bash
bun test apps/web/src/lib/navigation.test.ts
bun x ultracite check apps/web/src/pages/CustomizePage.tsx apps/web/src/pages/IntegrationsPage.tsx docs/website/content/docs/integrations.mdx
bun run knip
```

Update the PR screenshots: Control center (after) and the Connectors page.

## Done when

- The Integrations card has no duplicate rows and no duplicate icons.
- The Connectors page has no row that looks clickable but does nothing.
- Connectors rows look and behave like Control center rows.
- Back links return the user to the page they came from.
- The docs path and section list match the UI.
