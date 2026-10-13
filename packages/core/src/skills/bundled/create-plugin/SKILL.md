---
name: create-plugin
description: Draft or build a custom Nakama plugin with actions, a dashboard page, skills, workers, and migrations. Use when the user asks Super Bot to create a plugin.
include-body-on-match: true
---

Create a local draft for human review. Never install or enable the plugin yourself.

## Ask first (mandatory)

Before you run the template script for a new plugin, call `ask_user_question`
once. Then stop and wait for the answers. Do not write files in the same turn.

Ask only what the request does not already answer, in one batch of at most five
questions. Give each question two to four choices and set
`allowCustomAnswer: true`. Pick from:

- **Actions:** what each action does and the inputs it needs.
- **Access:** every member, or admins only (`access`).
- **Effect:** read only, or saves, sends, or deletes data (`effect`).
- **Data:** no stored data, files under `dataDir`, or a SQLite table (migrations).
- **Page:** what the page shows and which buttons it has, or no page.
- **Agent use:** whether profiles call the action as a tool in chat.
- **Outside services:** which API it calls. Plugins have no secret store, so a
  key needs an admin-only `save_settings` action with `exposeAsTool: false`
  that stores it under `dataDir`.

If the request answers all of them, ask one question instead: show the plan in
the prompt (plugin ID, actions with access and effect, page, data) with the
choices "Build it" and "Change something".

Build from the answers. Do not add actions, pages, or storage the user did not
ask for. If `ask_user_question` is not available, ask the same questions in one
plain message and wait. When the user asks to change an existing draft, ask
only if the change is unclear.

## Workspace and build

Use the profile workspace from the tool context. Write only beneath
`plugin-drafts/<pluginId>/`; use a stable lowercase slug for the plugin ID.
Keep `package.json`, `nakama.plugin.json`, `src/`, and built output together.
Put build instructions in `src/BUILD.md`. Keep sources after installation.

Start every new plugin from the template. Choose the plugin ID, display name,
and first action key, then run this from the profile workspace (bash cwd):

```sh
bun <skill directory>/scripts/new-plugin.mjs <plugin-id> "<Plugin Name>" <action-key>
```

The script writes `plugin-drafts/<plugin-id>/` with a manifest, package.json,
`src/<action-key>.js`, an example page in `src/ui.jsx` and `src/ui.css`,
`src/nakama-plugin.d.ts` (types for `ctx`), `src/BUILD.md`, and the built
`actions/<action-key>.js` and `ui/app.js`.
It refuses an existing draft; edit that draft instead. Then replace the example
action, page, description, and input schema with the real ones, and rebuild.

Check `bun --version` with bash. If Bun or a needed library is absent, report
the prerequisite. Do not install dependencies or coding tools silently.
An assigned bash tool is required. A coding-agent CLI is optional.
If delegating, explicitly request local-only drafting: no host repository edits,
push, PR, npm publishing, installation, or activation.

Use direct commands such as:

```sh
bun build ./src/greet.js --outfile actions/greet.js --target bun
bun build ./src/ui.jsx --outfile ui/app.js --target browser
```

Do not run generated package scripts or lifecycle scripts. Do not import actions,
load UI modules, execute workers or migrations, or call installation APIs.
Building uses the host shell; it is not sandboxed. Compilation proves only that
the build succeeded. Leave execution tests to the human reviewer.

## Minimal package and manifest

`package.json` needs a package name, matching version, and `"type": "module"`.
No nonempty `dependencies`, `optionalDependencies`, or `peerDependencies`.
Bundle libraries into output. Never depend on runtime `node_modules`.
Do not use an official plugin ID: workflows, supermemory, or google-meet.

```json
{
  "apiVersion": 1,
  "id": "greeting",
  "name": "Greeting",
  "description": "Greet a person.",
  "version": "1.0.0",
  "minNakamaVersion": "0.4.47",
  "author": "Your team",
  "license": "MIT",
  "actions": [{
    "key": "greet",
    "description": "Greet a person by name.",
    "entry": "actions/greet.js",
    "access": "member",
    "effect": "read",
    "exposeAsTool": true,
    "inputSchema": {
      "type": "object",
      "properties": { "name": { "type": "string", "minLength": 1 } },
      "required": ["name"],
      "additionalProperties": false
    }
  }],
  "skills": []
}
```

Set the minimum host version to one you support. Use `access: "admin"` for
admin-only actions and `effect: "write"` for mutations. Input schemas support
type, properties, required, additionalProperties, items, enum, string length,
numeric bounds, and array length bounds. Do not use remote references.
Any other keyword fails with `invalid_manifest: unsupported_schema`, including
`description`, `default`, `title`, and `format` on a property. Describe inputs in
the action `description` and apply defaults in `run`.

## Actions and host calls

Export `async function run(input, context)`. The host supplies `orgId`,
`pluginId`, `pluginVersion`, `actionKey`, `actor`, and `invocationId`.
Tool calls also receive `profileId`, `sessionId`, and `workspaceRoot`.
Write durable files under `context.dataDir`. Use `context.databasePath` for
SQLite, parameterize queries, and close the database in finally.
Never accept organization identity, roles, or storage paths from input.

Call `await context.host(request)` sequentially. Supported operations:
`{op:"profiles"}`, `{op:"tools",agentId}`,
`{op:"execute_tool",agentId,name,input}`, and
`{op:"summarize",agentId,prompt,bag}`.
The host checks profile access and assignments. It does not permit recursive
plugin-tool execution. Summaries have no tools.

## Optional capabilities

UI: declare `ui: {entryModule:"ui/app.js",assetsDir:"ui",pageLabel:"Greeting"}`.
Export `inject = ["slots","host","ui","styles"]` and `apply(ctx)`.
Use `ctx.React` and `ctx.ui`, never bundled React, React DOM, or internal
Nakama imports. Keep the `/** @jsxRuntime classic */` and
`/** @jsx React.createElement */` lines, the module-level `let React;`, and
`React = ctx.React;` in `apply` from the template. Never shadow it with
`const React` inside `apply`: components outside `apply` then crash with
`React is not defined`. Register exactly one page with
`ctx.slots.register("page", Component)`. Call actions through
`ctx.host.call(actionKey,input)`; it resolves to the action result.
Keep top-level code free of side effects.
Clean up React effects and `ctx.effect` resources.
Optional `tool:<actionKey>` renderers show the action result in chat. They
receive action, input, result, and status (`running` or `done`); handle older
result shapes and do not mutate during rendering.

## Nakama design style for pages

Make the page look like the rest of Nakama. Start from the template page.

- Components: use `ctx.ui` for every control: `Button` (variants `default`,
  `outline`, `ghost`, `secondary`, `destructive`, `link`; size `sm` in dense
  rows), `Input`, `Textarea`, `Select` parts, `Switch`, `Checkbox`, `Dialog`
  parts, `DropdownMenu` parts, `Tooltip`, `Spinner`. Do not build look-alike
  buttons or inputs from plain elements.
- Read `src/nakama-plugin.d.ts` before you use a component. It lists every
  `ctx`, `ctx.React`, and `ctx.ui` export with its props. Anything not listed
  is not available: no `toast()`, no `cn()`, no icons.
- Grouping: use `Card`, `CardHeader`, `CardTitle`, and `CardContent` for
  boxes such as stat tiles. The template CSS removes the card shadow; never
  set `box-shadow` yourself. `CardHeader` and `CardContent` pad 24px, so pass
  a class with `--n-space-4` padding for small tiles.
- Styling: Tailwind classes do not work in plugins. Put CSS in `src/ui.css`,
  import it as text, pass it to `ctx.styles(css)`, and nest every rule under
  `[data-plugin-id="<plugin-id>"]`.
- Tokens: the template `src/ui.css` defines the size tokens below. Use them
  and the host color variables in every rule. Do not write raw colors, sizes
  outside the scale, or gradients. The host already shows
  `pageLabel` as the page title and pads the page, so do not add a big title.

| Token | Value | Use |
|---|---|---|
| `--n-space-1/2/3/4/6` | 4, 8, 12, 16, 24px | gaps and padding |
| `--n-text-xs` | 12px | code, badges |
| `--n-text-sm` | 13px | secondary text, errors |
| `--n-text-base` | 14px | body |
| `--n-text-lg` | 18px | section titles (rare) |
| `--n-weight-medium` / `--n-weight-semibold` | 500 / 600 | labels / titles |
| `--n-radius` / `--n-radius-sm` | host radius (10px) / 6px | boxes / small chips |
| `--n-font-mono` | JetBrains Mono | code and IDs |
| `--n-content-width` | 720px | page max width (up to 960px for tables) |

| Host color | Light | Dark | Use |
|---|---|---|---|
| `--background` / `--foreground` | white / near black | #0a0a0b / #fafafa | page and text |
| `--card` | white | #18181b | raised boxes |
| `--muted` / `--muted-foreground` | light gray / mid gray | #1f1f23 / #a1a1aa | quiet fills / secondary text |
| `--border` | light gray | #27272a | 1px lines |
| `--primary` / `--primary-foreground` | #b45309 / white | #f59e0b / #0a0a0b | main action, links |
| `--destructive` | red | light red | errors, delete, bad numbers |
| `--n-positive` | emerald 700 | emerald 300 | good numbers, gains (template `ui.css`) |
| `--ring` | #b45309 | #f59e0b | focus outline |

Always write `var(--primary)`, never the hex value. The hex values are for
reference only; the variables switch with the theme. This table lists every
color you may use. Do not search the host or other folders for more tokens.
- Copy: one clear label per control. No subtitles or helper text unless a
  mistake would cause harm. Use `aria-label` on inputs without visible labels
  and on icon-only buttons.
- Page actions: pass buttons to `renderHeaderActions(...)` to place them in
  the page header.
- States: show a `Spinner` while loading, a short empty message, and errors in
  `--destructive` with `role="alert"`.
- Narrow widths: the page also opens in the chat side panel, where the
  content is about 360px wide. Use `flex-wrap` or
  `repeat(auto-fit, minmax(100px, 1fr))` grids, not a fixed column count, and
  no fixed widths; three tiles then fit one row.
- Tables: show at most four columns, and put the column the user cares about
  most right after the name column. Wrap the table in an `overflow-x: auto`
  box so extra width scrolls instead of breaking the page.
- Do not: add a hero block, `h1`/`h2` headings, all-caps letter-spaced labels,
  taglines, numbered feature lists, pill shapes (`999px` radius), or bordered
  `div`s that copy `Card`. Nakama pages are plain work tools, not landing pages.
- A request for a nicer or better page means these rules applied with more
  care. It does not mean more decoration.

Skills: declare `skills: [{key:"use-greeting",directory:"skills/use-greeting"}]`
and include that directory's SKILL.md with name and description.

Database: declare ordered immutable migrations, for example
`database: {migrations:[{id:"001",path:"migrations/001.sql"}]}`.
Never edit a released migration. First enable and updates execute SQL.

Workers: declare up to eight bundled JS entries, for example
`workers:[{key:"indexer",name:"Indexer",entry:"workers/indexer.js"}]`.
Workers start on enable. Store data in NAKAMA_PLUGIN_DATA_DIR or
NAKAMA_WORKER_DATA_DIR and handle termination with cleanup.
Optional useHostLlm supplies an owner-only provider configuration.

## Handoff

After the last successful build, call `submit_plugin_draft` with the draft ID.
It shows a card that walks the admin through review, install, enable, and
profile access. If it fails, fix the reported problem, rebuild, and call it again.

Then report the build result in one or two lines. State that the draft is uninstalled.
A platform admin reviews source and built files before installation.
Fresh installations stay disabled. An admin enables them separately and assigns
new actions to profiles. Installed plugins have full server/browser privileges.
