// Scaffold a plugin draft from ../template and build its first action.
// Usage: bun new-plugin.mjs <plugin-id> "<Plugin Name>" [action-key]
// Run it from the profile workspace; it writes plugin-drafts/<plugin-id>/.
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ID = /^[a-z][a-z0-9-]{0,63}$/;

const ACTION_KEY = /^[a-z][a-z0-9_-]{0,63}$/;

const OFFICIAL_IDS = new Set(["workflows", "supermemory", "google-meet"]);

const [id, name, action = "greet"] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!(id && PLUGIN_ID.test(id))) {
  fail("Plugin ID must be lowercase letters, digits, and dashes.");
}

if (OFFICIAL_IDS.has(id)) {
  fail(`"${id}" is an official plugin ID. Choose another.`);
}

if (!name?.trim()) {
  fail("Plugin name is required.");
}

if (!ACTION_KEY.test(action)) {
  fail("Action key must be lowercase letters, digits, dashes, or underscores.");
}

const templateDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "template"
);

const target = path.resolve("plugin-drafts", id);

if (await stat(target).catch(() => null)) {
  fail(`${target} already exists. Edit it instead.`);
}

const tokens = {
  __ACTION_KEY__: action,
  __PLUGIN_ID__: id,
  __PLUGIN_NAME__: name.trim().replaceAll('"', "'"),
};

function fill(text) {
  return Object.entries(tokens).reduce(
    (result, [token, value]) => result.replaceAll(token, value),
    text
  );
}

const entries = await readdir(templateDir, { recursive: true });

for (const entry of entries) {
  if (!entry.endsWith(".tmpl")) {
    continue;
  }

  const output = path.join(target, fill(entry.slice(0, -".tmpl".length)));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(
    output,
    fill(await readFile(path.join(templateDir, entry), "utf8"))
  );
}

const build = await Bun.build({
  entrypoints: [path.join(target, "src", `${action}.js`)],
  naming: `${action}.js`,
  outdir: path.join(target, "actions"),
  target: "bun",
});

if (!build.success) {
  fail(build.logs.map(String).join("\n"));
}

console.log(`Created ${target}`);
