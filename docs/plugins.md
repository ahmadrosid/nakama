# Plugin authoring

Nakama plugins are trusted ZIP packages. A platform admin installs the bytes. An organization admin activates them. Plugin code runs as ordinary Bun and browser JavaScript — there is no sandbox.

## Package layout

```text
nakama.plugin.json
actions/*.js
skills/<key>/SKILL.md
ui/index.html
ui/assets/*
migrations/*.sql
hooks/activate.js      # optional
hooks/deactivate.js    # optional
```

The archive may put those files at the root or inside one top-level folder. `PluginService` resolves that package root from the single `nakama.plugin.json`.

Actions must be prebuilt, self-contained JavaScript. Do not rely on `node_modules` at runtime. Nakama starts plugin children with `--no-install`.

## Manifest

`apiVersion` is `1`. `id` is a stable slug (`notes`). `version` and `minNakamaVersion` are SemVer. Unknown API versions fail preview.

Supported JSON Schema keywords on action input: `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `minLength`, `maxLength`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minItems`, `maxItems`. Remote `$ref` and other keywords are rejected.

Action `key` values become agent tool names as `plugin_<id>__<key>` when `exposeAsTool` is true. Example: `plugin_notes__list`.

## Compatibility

Installing the same id/version/digest is idempotent. Different bytes for an existing version conflict. Updates run only while the organization plugin is disabled. A failed migration keeps the previous code and database generation selected and disabled.

## Action context

`run(input, context)` receives host-derived context only:

- `apiVersion`, `pluginId`, `pluginVersion`, `orgId`
- `actor.id`, `actor.role`
- `invocationId`
- `dataDir` — organization plugin files
- `databasePath` — selected generation, when the plugin declares migrations
- `profileId`, `sessionId`, `workspaceRoot` — tool calls only

Spoofed org, role, or path fields in input are stripped. Use `bun:sqlite` against `context.databasePath`. Write extra files under `context.dataDir`.

## Schema and migrations

List migrations in order with immutable ids. Nakama applies them to a private database generation, records checksums, then publishes the generation with the release. Do not put schema changes in activate hooks.

## Lifecycle idempotency

Activation retries reuse a stable operation id. Hooks must tolerate being run more than once. Disable still finishes if a deactivate hook fails. Uninstall keeps organization data until a separate confirmed delete.

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

## React page

Bundle your own React and React DOM. Do not import the host app.

1. Set Vite `base: "./"` so assets work under `/v1/plugins/ui/{orgId}/{pluginId}/`.
2. After mount, send:

```js
parent.postMessage(
  { type: "nakama-plugin-ready", pluginId: "notes" },
  window.location.origin
);
```

3. Fetch `__nakama/bootstrap.json?theme=`.
4. POST actions to `/v1/plugins/{pluginId}/actions/{key}` with `X-Org-Id` from bootstrap and `X-CSRF-Token` from the `nakama_csrf` cookie.

## Build and pack

From your plugin directory, build the UI into `ui/` and package the files declared by your manifest:

```bash
bun install
bun run build
zip -r plugin-1.0.0.zip nakama.plugin.json actions skills ui migrations
```

Include the built UI assets in the ZIP so installation does not need to run Vite. Omit directories for capabilities your plugin does not use.
