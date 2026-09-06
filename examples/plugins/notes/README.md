# Notes plugin

Example plugin with a skill, React page, two agent tools, and an organization SQLite database.

Tools are `plugin_notes__list` and `plugin_notes__create`. The page and those tools read the same notes.

## Rebuild the page

From this directory:

```bash
bun install
bun run build
```

Vite writes `ui/` with relative asset URLs so the page works under `/v1/plugins/ui/{orgId}/notes/`.

The committed `ui/` folder is enough to install without running Vite.

## Pack a ZIP

Zip so `nakama.plugin.json` is at the archive root, or inside one top-level folder:

```bash
zip -r notes-1.0.0.zip \
  nakama.plugin.json \
  actions \
  skills \
  ui \
  migrations
```

Do not include `node_modules` or `ui-src`. Actions are self-contained JavaScript.

A platform admin installs that ZIP. An org admin then adds and enables Notes under **System → Plugins**.
