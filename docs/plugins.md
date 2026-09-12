# Plugin authoring

Nakama plugins are trusted npm packages. A platform admin installs the bytes. An organization admin activates them. Plugin code runs as ordinary Bun and browser JavaScript — there is no sandbox.

## Official plugins

The **Official plugins** catalog is an allowlist shipped with Nakama. Organization admins can install these packages with one click; no npm lookup or separate platform approval is required. Third-party package installation still requires platform approval.

Workflows lives in `packages/plugins/workflows`. Its manifest, bundled actions, UI, skills, and migrations are copied into the same immutable release store used for npm plugins. It uses the existing organization lifecycle, contribution ownership, private database generations, backup, and retained-data deletion. A package's `author` or id never makes it official.

Official catalog entries declare required host support and an optional setup action. Installation checks requirements before publishing a release. If setup fails after this install enabled the plugin, it disables the plugin while retaining its data for retry; a plugin that was already enabled is left running.

This follows the declared-dependency and reversible-effect ideas described in [DeepSeek Harness's Cordis primer](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md). Nakama uses its existing package and organization lifecycle for these guarantees.

Run `bun run --cwd packages/plugins/workflows build` after source edits and include the updated action and UI bundles in the change. Runtime images include the package under `packages/plugins`; source development and built server entrypoints use the same catalog.

For local development, rebuild the plugin, then choose **System → Plugins → Official plugins → Reinstall**. Organization admins can reload the bundled files without manually bumping the package version. Reinstall preserves workflows, run history, and the enabled/disabled state. It creates an immutable development release for changed content and switches only the active organization; other organizations keep their selected code. Unchanged content reuses its development release. If an update or migration fails, the plugin remains disabled with its previous data available for recovery.

### Supermemory

`packages/plugins/supermemory` is the official explicit-memory and text-knowledge plugin. Rebuild with `bun run --cwd packages/plugins/supermemory build` and include both bundles. It requires the existing profile host capability and performs no network setup during installation.

The API target for initial contract verification is **Supermemory server 0.0.8**, with `OPENAI_MODEL=gpt-5.1`, `SUPERMEMORY_EMBEDDING_PROVIDER=openai`, `SUPERMEMORY_EMBEDDING_MODEL=text-embedding-3-small`, and `SUPERMEMORY_EMBEDDING_DIMENSIONS=1536`. Set `OPENAI_API_KEY` on the external server. Live OpenAI-backed verification remains a release gate; the deterministic tests exercise documented HTTP responses and must not be described as a live-server compatibility proof.

The plugin derives distinct memory/knowledge container tags from its persisted namespace, organization and validated profile. Tools use host profile context; the page passes `agentId`. It uses `/v4/memories` for explicit facts, memory-only `/v4/search`, and document-only `/v3/search` for knowledge. Search hits must match local receipts and the metadata written by this installation. Failed remote removal leaves a local tombstone, immediately excluding the item from plugin recall.

Each save requires a stable `submissionKey`. Receipts reserve it under a SQLite uniqueness constraint before HTTP; changing content under the same key fails. Documents use a deterministic `customId`; unresolved memories reconcile with a scoped metadata-filtered list. No ambiguous write is automatically replayed. A process interrupted during submission becomes unknown after 30 seconds.

Connection settings live in an atomic, owner-only `connection.json` under the plugin data directory. Redacted reads never return tokens. Settings updates and receipt reservations share the database write lock, without holding it during HTTP. The host restores files with owner-only permissions, which the plugin rechecks on use. Same-org backups preserve the namespace; a different-org dataset fails closed. Full backups contain credentials and need appropriate protection. External Supermemory data needs its own backup.

## Package layout

```text
package.json
nakama.plugin.json
actions/*.js
skills/<key>/SKILL.md
ui/app.js
ui/assets/*
migrations/*.sql
```

Publish to the public npm registry. Put `nakama.plugin.json` beside `package.json`; their versions must match. Admins enter the npm package name and exact version. Tags, ranges, Git URLs, local paths, private registries, and archive uploads are not supported.

Preview records the package digest and registry SHA-512 integrity. Installation rechecks both before publishing the release.

Actions must be prebuilt, self-contained JavaScript. Declare build tools and libraries in `devDependencies` and bundle them into the output. Nonempty `dependencies`, `optionalDependencies`, and `peerDependencies` are rejected; Nakama never installs dependencies or runs package lifecycle scripts. Do not rely on `node_modules` at runtime. Nakama starts plugin children with `--no-install`.

## Manifest

`apiVersion` is `1`. `id` is a stable slug (`notes`). `version` and `minNakamaVersion` are SemVer. Unknown API versions fail preview.

Set optional `icon` to an HTTPS image URL, for example `"icon": "https://example.com/icon.svg"`. The plugin list displays it in a 40px square and uses a fallback if the image fails to load. Workflows and Supermemory have distinct built-in fallback icons.

Supported JSON Schema keywords on action input: `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `minLength`, `maxLength`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minItems`, `maxItems`. Remote `$ref` and other keywords are rejected.

Action `key` values become agent tool names as `plugin_<id>__<key>` when `exposeAsTool` is true. Example: `plugin_notes__list`.

## Compatibility

Installing the same id/version/digest is idempotent. Different bytes for an existing version conflict. Updates run only while the organization plugin is disabled. A failed migration keeps the previous code and database generation selected and disabled.

## Action context

`run(input, context)` receives host-derived context only:

- `apiVersion`, `pluginId`, `pluginVersion`, `orgId`, `actionKey`
- `actor.id`, `actor.role`
- `invocationId`
- `dataDir` — organization plugin files
- `databasePath` — selected generation, when the plugin declares migrations
- `profileId`, `sessionId`, `workspaceRoot` — tool calls only

Spoofed org, role, or path fields in input are stripped. Use `bun:sqlite` against `context.databasePath`. Write extra files under `context.dataDir`.

## Host calls

Actions can call `await context.host(request)` sequentially through the invocation's IPC channel. The host supplies organization and actor identity, checks profile access, and only executes tools assigned to the requested profile. Host work is cancelled when the action ends, times out, or is disabled. Calls to other plugin tools are excluded to prevent recursive subprocess chains.

Supported operations: `profiles`; `tools` with `agentId`; `execute_tool` with `agentId`, `name`, and `input`; and `summarize` with `agentId`, `prompt`, and a `bag` of step results. A summary has no tools. Requests cannot choose the organization or actor. Viewers and cross-organization profiles are rejected; Super Bot requires an admin.

The official Workflows plugin additionally uses host operations to read its legacy data for import and inspect the existing organization SQLite tool data. Legacy import is admin-only and read-only at the source. Its plugin database records completion so reinstalling does not resurrect deleted workflows.

The official workflow run action has a five-minute execution budget; other actions retain the normal custom-tool timeout.

## Schema and migrations

List migrations in order with immutable ids. Nakama applies them to a private database generation, records checksums, then publishes the generation with the release.

## Lifecycle

Disable stops new actions and drains running calls. Uninstall keeps organization data until a separate confirmed delete. Activation and deactivation hooks are not supported.

## Managed paths

Relative to `NAKAMA_CONFIG_DIR` (default `~/.nakama`):

- Packages: `plugins/{pluginId}/{version}/`
- Organization data: `orgs/{orgId}/plugins/{pluginId}/`
- Selected SQLite: `orgs/{orgId}/plugins/{pluginId}/db/{generation}.sqlite`

Do not resolve paths from the repository working directory.

## Trust model

Platform approval is an authorization gate, not a sandbox. Installed plugin code can use the same host files and signed-in browser authority the process already has. Do not claim isolation against a malicious author.

## Manual recovery

If a package directory or selected database file is missing, the plugin stays manageable and is marked unavailable. Reinstall the same approved release, or enable after the files are restored. Backup ZIP restore leaves plugins disabled; an admin enables them again. See [Backup and restore](./website/content/docs/backup-restore.mdx) for operator steps.

## Native React pages

Plugin UI follows DeepSeek Harness's component-slot approach: Nakama imports the browser module and runs its `apply(ctx)`. The plugin registers a React component in its own `page` slot. Nakama mounts that component directly inside the dashboard with the host's React instance.

Declare the module in the manifest:

```json
"ui": { "entryModule": "ui/app.js", "assetsDir": "ui", "pageLabel": "Notes" }
```

The module must export `inject` and `apply`:

```js
export const inject = ["slots", "host"];
export function apply(ctx) {
  const React = ctx.React;
  function NotesPage() {
    const [notes, setNotes] = React.useState([]);
    React.useEffect(() => {
      let active = true;
      ctx.host.call("list", {}).then(result => {
        if (active) setNotes(result);
      }).catch(console.error);
      return () => { active = false; };
    }, []);
    return React.createElement("pre", null, JSON.stringify(notes));
  }
  ctx.slots.register("page", NotesPage);
}
```

Services must be declared in `inject`; unavailable or undeclared services fail activation:

- `slots.register("page", Component)` registers exactly one page for this plugin.
- Page components receive an optional `renderHeaderActions(children)` prop. Render its return value inside the page to place controls in the host's top navigation bar; the host owns placement and cleanup.
- `host.call(actionKey, input)` invokes this plugin's backend action. Nakama supplies authentication, CSRF, and the activation's org; plugins do not build raw API requests.
- `ui` exposes the shared `@nakama/ui` components (for example `const { Button, Input } = ctx.ui`). Declare `"ui"` in `inject`; use type-only `@nakama/ui` imports for TypeScript. The host supplies React and the component styles, so do not bundle React or the UI library into a plugin.
- `styles(css)` adds a stylesheet and removes it on unload. Scope selectors under `[data-plugin-id="your-plugin-id"]` so they do not affect the dashboard.

Every context also receives `React`, `orgId`, `pluginId`, `theme`, `signal`, and `effect(setup)`. An effect's setup must return a cleanup function. Cleanup runs on navigation, org/theme/revision changes, failed activation, or unmount. React render failures are contained by the page error boundary. Startup has a 12-second deadline.

Plugins that need shadcn-style controls must use `ctx.ui` from `packages/ui` for buttons, inputs, selects, switches, menus, and dialogs. Keep plugin CSS focused on layout; do not replace the shared control styles with broad `button` or `input` selectors. Menus and dialogs render in host portals, so layout styles scoped to the plugin page do not reach their content.

Bundle browser code as one self-contained ESM module without bundling React or React DOM. Use `ctx.React.createElement`, or compile JSX in classic mode against a local `React = ctx.React`. The official Workflows source is an example. Do not import Nakama's internal modules. Module URLs include the package version and org installation revision; keep top-level code free of side effects and register effects inside `apply`.

This replaces the pre-release HTML/iframe UI contract. Convert `entryHtml` to `entryModule` and replace bootstrap/ready messages with `inject`/`apply`. Backend actions and stored plugin data keep their existing contract. These are trusted browser modules; declared services and effect cleanup are lifecycle controls, not a JavaScript security sandbox. Supported UI slots include the plugin page and plugin-owned tool renderers; this does not introduce DeepSeek's dynamic code-authoring tools or its full runtime.

## Chat tool renderers

A plugin can register React renderers for its own actions in the same browser module as its page:

```js
ctx.slots.register("tool:run_workflow", function WorkflowCard({ action, input, result, status }) {
  return ctx.React.createElement("pre", null,
    status === "running" ? "Running…" : JSON.stringify(result, null, 2));
});
```

Use the original action key after `tool:`, not the full `plugin_<id>__<key>` tool name. Registration requires `"slots"` in `inject`. Each action accepts one renderer; duplicate or malformed registrations fail activation. The page registration remains required.

Renderers receive `action`, `input` (the tool arguments, when available), `result` (the returned tool result, when available), and `status` (`running` or `done`). These props update as the chat tool call progresses. `done` means the call ended; inspect the result for application errors. Do not execute mutations during render or mount. Use explicit controls for mutations and `ctx.host.call` for backend actions. The host enforces existing action permissions.

Chat matches tool names against the active organization's installed plugin actions, including normalized hyphens. Plugins cannot register renderers for native tools or other plugins. Only enabled plugins with a UI module are loaded; missing, disabled, failed, or unregistered renderers use the standard tool display. Startup and render failures are contained to the card.

Nakama mounts each card with the host React instance, shared `ctx.ui`, and a `data-plugin-id` wrapper. Scope styles as for plugin pages. Each mounted surface owns an activation: use component effect cleanup for polling and `ctx.effect` for activation resources. Unmounts, organization changes, theme changes, and installation revisions dispose the old activation. Historical tool results use the currently enabled release's renderer, so tolerate older result shapes.

The Workflows plugin registers `tool:run_workflow`; its card reads recorded receipts and polls its own read actions while running. Native legacy `run_workflow` messages retain the native card.

## Build and publish

Use a package manifest like this (omit unused capability directories):

```json
{
  "name": "@your-team/nakama-notes",
  "version": "1.0.0",
  "type": "module",
  "files": ["nakama.plugin.json", "actions", "skills", "ui", "migrations"]
}
```

From your plugin directory, build the actions and UI, inspect the published files, then publish:

```bash
bun install
bun run build
npm pack --dry-run
npm publish --access public
```

Include built UI assets and bundled JavaScript in the published package. In **System → Plugins**, preview `@your-team/nakama-notes` at `1.0.0`, then approve installation.


### Profile assignment and discovery

The profile Tools list groups actions by plugin. Adding a plugin assigns its currently available actions in one interaction; removing the group removes the assigned actions. Existing partial assignments remain partial until an admin adds the remaining actions. New actions introduced by a plugin update are not automatically assigned.

Chat keeps ordinary tools available immediately. Assigned plugin actions contribute only a compact name catalog to `find_tools` initially. The agent searches by plugin or action name, then receives up to five matching definitions on the next model call. Repeating a broad search loads the remaining matches. Loaded definitions stay available for the current user request and reset on the next request, in both streaming and non-streaming chat. Prior tool calls and results remain in conversation history.

Discovery cannot add unassigned actions. Execution still checks the current organization, profile assignment, actor role, and plugin lifecycle state. Discovery does not execute an action, and a newly discovered action cannot execute until the next model call. This reduces initial schema size; a turn using every action still pays for those definitions after discovery.
