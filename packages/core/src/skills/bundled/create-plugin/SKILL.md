---
name: create-plugin
description: Draft or build a custom Nakama plugin with actions, an optional dashboard page, skills, workers, and migrations. Use when the user asks Super Bot to create a plugin.
include-body-on-match: true
---

Create a local draft for human review. Never install or enable the plugin yourself.

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
`src/<action-key>.js`, `src/BUILD.md`, and the built `actions/<action-key>.js`.
It refuses an existing draft; edit that draft instead. Then replace the example
action, description, and input schema with the real ones, and rebuild.

Check `bun --version` with bash. If Bun or a needed library is absent, report
the prerequisite. Do not install dependencies or coding tools silently.
An assigned bash tool is required. A coding-agent CLI is optional.
If delegating, explicitly request local-only drafting: no host repository edits,
push, PR, npm publishing, installation, or activation.

Use direct commands such as:

```sh
bun build ./src/greet.js --outfile actions/greet.js --target bun
bun build ./src/ui.js --outfile ui/app.js --target browser
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
Nakama imports. Register exactly one page with
`ctx.slots.register("page", Component)`. Call actions through
`ctx.host.call(actionKey,input)`. Scope CSS under
`[data-plugin-id="greeting"]`. Keep top-level code free of side effects.
Clean up React effects and `ctx.effect` resources.
Optional `tool:<actionKey>` renderers receive action, input, result, and status;
handle older result shapes and do not mutate during rendering.

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
