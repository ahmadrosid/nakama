---
name: create-plugin
description: Draft or build a custom Nakama plugin with actions, a dashboard page, skills, workers, and migrations. Use when the user asks to create or change a plugin.
---

Create a local draft for human review. Never install or enable the plugin yourself.

## Flow

Do these steps in order. After the user answers the questions, do steps 2 to 5 in the same turn. Do not stop to report progress.

1. **Ask once.** Call `ask_user_question` one time, then stop and wait. Ask only what the request does not answer, at most five questions, two to four choices each, `allowCustomAnswer: true`:
   - **Actions:** what each action does and its inputs.
   - **Access:** every member, or admins only.
   - **Effect:** read only, or saves, sends, or deletes data.
   - **Page:** what it shows and which buttons it has, or no page.
   - **Outside services:** which API it calls. Plugins have no secret store, so a key needs an admin-only `save_settings` action with `exposeAsTool: false` that stores it under `dataDir`.

   If the request answers all of them, ask one question: show the plan (plugin ID, actions with access and effect, page, data) with the choices "Build it" and "Change something". Do not ask a second round. When an answer leaves a detail open, choose the simple option and say so in the final report. If `ask_user_question` is not available, ask in one plain message.
2. **Scaffold.** Run from the profile workspace (bash cwd):

   ```sh
   bun <skill directory>/scripts/new-plugin.mjs <plugin-id> "<Plugin Name>" <action-key>
   ```

   Add `--data` in place of `<action-key>` when the page shows a list of records, stored or fetched (contacts, tickets, issues, orders). It gives the list page: filter, table, and one edit dialog. For records from an outside source, change `list_items` to fetch them and remove the migration if nothing is stored. The script prints the files to edit and the template text that is left. It refuses an existing draft; edit that draft.

   Add `--charts` (with or without `--data`) when the page shows charts. It adds `src/charts.jsx` with `LineChart`, `BarChart`, and `PieChart`; the script prints how to use them. Do not read, edit, or replace those files, and do not draw charts yourself.
3. **Edit.** Replace the example action, page, descriptions, and input schemas with the real ones. Add nothing the user did not ask for. Use relative paths such as `plugin-drafts/<plugin-id>/src/ui.jsx` in every file tool. The scaffolded files follow the rules below, so change only what the plugin needs; do not re-read files that the script just wrote unless you need their exact text for an edit.
4. **Build and check.**

   ```sh
   bun <skill directory>/scripts/build-plugin.mjs <plugin-id>
   ```

   It checks the manifest with the host's rules, bundles every `src/<name>.js` to its manifest entry and `src/ui.jsx` to `ui/app.js`, and lints the page style. It lists every problem at once: fix all of them, then run it again.
5. **Hand off.** When the build passes, call `submit_plugin_draft` with the draft ID. If it fails, fix the reported problem, build, and call it again. Then report in one or two lines: what the plugin does, that the draft is not installed, and any choice you made for the user. An admin reviews the files, installs, enables, and gives profiles access from the card. Installed plugins have full server and browser privileges.

To change an installed plugin, read `references/change-installed.md` first. For plugin skills, a SQLite database, or workers, read `references/skills-database-workers.md`.

## Limits

- Write only under `plugin-drafts/<plugin-id>/`. Use a stable lowercase slug. Do not use an official plugin ID (workflows, supermemory, data-view, google-meet).
- If `bun --version` fails, report it. Do not install dependencies or tools. `package.json` must have no `dependencies`, `optionalDependencies`, or `peerDependencies`; bundle libraries into the output.
- Do not run package scripts, import actions, load the page, run workers or migrations, or call install APIs. A build proves only that the code compiles.
- Do not read the skill's scripts or templates; their output says what to do.
- If you delegate to a coding agent, ask for local-only drafting: no repository edits, push, PR, publish, or install.

## Manifest

`access: "admin"` for admin-only actions; `effect: "write"` for actions that change data; `exposeAsTool: true` lets profiles call the action in chat. Input schemas take only: `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `minLength`, `maxLength`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minItems`, `maxItems`. No `description`, `default`, `title`, or `format`: describe inputs in the action description and apply defaults in `run`.

## Actions

When an action scrapes HTML, decode entities (`&amp;`, `&#39;`, `&quot;`) in every text it saves.

Export `async function run(input, context)`. `context` has `orgId`, `pluginId`, `pluginVersion`, `actionKey`, `actor`, `invocationId`, `dataDir`, and `databasePath`; tool calls also get `profileId`, `sessionId`, and `workspaceRoot`. Write files under `context.dataDir`. For SQLite use `context.databasePath`, parameterized queries, and close the database in `finally`. Never take organization, role, or storage paths from input.

Host calls, one at a time: `await context.host({op:"profiles"})`, `{op:"tools",agentId}`, `{op:"execute_tool",agentId,name,input}`, `{op:"summarize",agentId,prompt,bag}`. The host checks profile access. Plugin tools cannot call plugin tools. Summaries have no tools.

## Page

Keep the template's structure: the JSX pragma lines, module-level `let React;`, `React = ctx.React;` in `apply`, `ctx.styles(css)`, one `ctx.slots.register("page", Page)`, and optional `tool:<actionKey>` renderers (they get `action`, `input`, `result`, `status`). Call actions with `await ctx.host.call(actionKey, input)`. Clean up effects.

`ctx.ui` gives: `Button` (variants `default`, `outline`, `ghost`, `secondary`, `destructive`, `link`; `size="sm"` in rows), `Input`, `Textarea`, `FormField`, `Select` parts, `Switch`, `Checkbox`, `Card` parts, `Dialog` parts, `ConfirmDialog`, `DropdownMenu` parts, `Tooltip`, `Spinner`, `Table` parts, and `CodeBlock`. There is no `toast()`, `cn()`, or icon set. Open `src/nakama-plugin.d.ts` only to look up the props of a component the template does not use.

Style rules (`build-plugin.mjs` checks most of them):

- A plain work tool, not a landing page: no headings, hero blocks, taglines, all-caps labels, pills, or shadows. The host shows `pageLabel` as the title and pads the page.
- One clear label per control. No helper text unless a mistake would cause harm. `aria-label` on inputs without a label and on icon-only buttons.
- CSS goes in `src/ui.css`, nested under `[data-plugin-id="<plugin-id>"]`. Tailwind does not work. Use only the template tokens (`--n-space-1/2/3/4/6`, `--n-text-xs/sm/base/lg`, `--n-weight-medium/semibold`, `--n-radius`, `--n-radius-sm`, `--n-font-mono`) and host colors: `--background`, `--foreground`, `--card`, `--muted`, `--muted-foreground`, `--border`, `--primary`, `--primary-foreground`, `--destructive`, `--n-positive`, `--ring`.
- Page buttons go in `renderHeaderActions(...)`.
- Build the page around the one decision the user makes on it; put what decides it first. Cut sections that are there only because pages usually have them.
- One accent: `--primary` marks the main action and the main series only.
- Show real numbers only. No made-up deltas, sample rows, or filler names.
- States: `Spinner` while loading. An empty or error state says why, and names the one action that fixes it ("No runs yet. Click Scrape now."). Errors in `--destructive` with `role="alert"`.
- The page also opens in a 360px side panel: wrap with `flex-wrap` or `repeat(auto-fit, minmax(100px, 1fr))`, no fixed widths.
- Tables: at most six columns, the most useful one after the name. Less useful columns get `plugin-optional`; dates and numbers `plugin-number`; the name cell `plugin-strong`; short text cells `plugin-nowrap`. A name that can be long (titles, URLs) also gets `plugin-clamp`. Show at most 25 rows; let the filter find the rest. Show due or overdue work as a column, overdue in `--destructive`.
- Width: the page fills the width the host gives it. Only a page that is a short form takes `plugin-page-narrow`.
- Dashboards: only stats and charts that help that decision. Charts come from `src/charts.jsx`, each in a `Card` whose `CardTitle` is the question it answers ("Average price per run"), not "Overview". Put small charts side by side with `repeat(auto-fit, minmax(320px, 1fr))`. Pass a `format` for money and percent. If one sentence answers the question better, write the sentence.
- Table columns come from that decision, with the deciding field right after the name.
- Records: the name cell is a `Button variant="link"` with `plugin-row-link` that opens one `Dialog` for create, edit, and delete. No button columns. Delete is a `destructive` button with `plugin-footer-start`, confirmed with `ConfirmDialog`. The create button (`New <thing>`) goes in the header. One filter `Input`, no Search button. Every `DialogContent` gets `data-plugin-id={ctx.pluginId}`.
- Tool renderers show a result as text, a short list, or a small table, not raw JSON.
- If the user asks for a style that breaks these rules, follow the rules and say in one line what you did not apply. "Nicer" means these rules with more care, not more decoration.
