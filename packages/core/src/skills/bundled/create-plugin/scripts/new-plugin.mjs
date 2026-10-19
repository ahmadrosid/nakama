// Scaffold a plugin draft from ../template and build its actions and page.
// Usage: bun new-plugin.mjs <plugin-id> "<Plugin Name>" [action-key]
//        bun new-plugin.mjs <plugin-id> "<Plugin Name>" --data
// --data lays ../data-template over ../template: a SQLite table, list_items
// and save_item actions, and a page with a Table and an edit Dialog.
// Run it from the profile workspace; it writes plugin-drafts/<plugin-id>/.
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ID = /^[a-z][a-z0-9-]{0,63}$/;

const ACTION_KEY = /^[a-z][a-z0-9_-]{0,63}$/;

const OFFICIAL_IDS = new Set(["workflows", "supermemory", "google-meet"]);

const args = process.argv.slice(2);

const data = args.includes("--data");

const [id, name, action = "greet"] = args.filter((arg) => arg !== "--data");

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

const skillDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const ACTION_TEMPLATE = path.join("src", "__ACTION_KEY__.js.tmpl");

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

// Template file (relative path) -> source path. Data files replace base files.
const sources = new Map();

for (const dir of data ? ["template", "data-template"] : ["template"]) {
  const root = path.join(skillDir, dir);

  for (const entry of await readdir(root, { recursive: true })) {
    if (entry.endsWith(".tmpl") && !(data && entry === ACTION_TEMPLATE)) {
      sources.set(entry, path.join(root, entry));
    }
  }
}

for (const [entry, source] of sources) {
  const output = path.join(target, fill(entry.slice(0, -".tmpl".length)));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, fill(await readFile(source, "utf8")));
}

const manifest = JSON.parse(
  await readFile(path.join(target, "nakama.plugin.json"), "utf8")
);

const builds = [
  ...manifest.actions.map(({ key }) => ({
    entry: `${key}.js`,
    file: `${key}.js`,
    out: "actions",
    target: "bun",
  })),
  { entry: "ui.jsx", file: "app.js", out: "ui", target: "browser" },
];

for (const item of builds) {
  const build = await Bun.build({
    entrypoints: [path.join(target, "src", item.entry)],
    naming: item.file,
    outdir: path.join(target, item.out),
    target: item.target,
  });

  if (!build.success) {
    fail(build.logs.map(String).join("\n"));
  }
}

console.log(`Created ${target}`);
