# Change an installed plugin

A draft lives only in the workspace of the agent that built it, and another agent may have changed the plugin since. Before changing an installed plugin, find its newest release. Releases sit beside the skills folder, one folder per version:

```sh
ls -d "<skill directory, from the load_skill result>/../../../plugins/<plugin-id>"/*/ | sort -V | tail -1
```

Keep editing your own `plugin-drafts/<plugin-id>/` when its `nakama.plugin.json` version is the same as or newer than the release, ignoring the release's `+dev.<digest>` suffix. If the release is newer, or you have no draft, move any old draft aside (`mv plugin-drafts/<plugin-id> plugin-drafts/<plugin-id>-old`) and start from the release:

```sh
mkdir -p plugin-drafts
cp -r "<newest release>" plugin-drafts/<plugin-id>
chmod -R u+w plugin-drafts/<plugin-id>
```

The release keeps `src/`, `src/BUILD.md`, and the migrations. Its version ends in `+dev.<digest>`: drop that suffix and raise the version in both `nakama.plugin.json` and `package.json`. Keep every existing migration and add new ones after them, because the installed data already ran them. If the release has no `src/`, tell the user the plugin cannot be changed from source here.

Then edit, run `build-plugin.mjs`, and submit as for a new draft.
