# Plugin authoring

Nakama plugins are trusted npm packages. A platform admin installs the bytes. An organization admin activates them. Plugin code runs as ordinary Bun and browser JavaScript — there is no sandbox.

## Package layout

```text
package.json
nakama.plugin.json
actions/*.js
skills/<key>/SKILL.md
ui/index.html
ui/assets/*
migrations/*.sql
```

Publish to the public npm registry. Put `nakama.plugin.json` beside `package.json`; their versions must match. Admins enter the npm package name and exact version. Tags, ranges, Git URLs, local paths, private registries, and archive uploads are not supported.

Preview records the package digest and registry SHA-512 integrity. Installation rechecks both before publishing the release.

Actions must be prebuilt, self-contained JavaScript. Declare build tools and libraries in `devDependencies` and bundle them into the output. Nonempty `dependencies`, `optionalDependencies`, and `peerDependencies` are rejected; Nakama never installs dependencies or runs package lifecycle scripts. Do not rely on `node_modules` at runtime. Nakama starts plugin children with `--no-install`.

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
