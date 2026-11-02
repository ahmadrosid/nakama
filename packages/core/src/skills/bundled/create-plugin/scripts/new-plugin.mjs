// Scaffold a plugin draft from ../template and build its actions and page.
// Usage: bun new-plugin.mjs <plugin-id> "<Plugin Name>" [action-key]
//        bun new-plugin.mjs <plugin-id> "<Plugin Name>" --data
// --data lays ../data-template over ../template: a SQLite table, list_items
// and save_item actions, and a page with a Table and an edit Dialog.
// Run it from the profile workspace; it writes plugin-drafts/<plugin-id>/.
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDraft, OFFICIAL_IDS } from "./build-plugin.mjs";

const PLUGIN_ID = /^[a-z][a-z0-9-]{0,63}$/;

const ACTION_KEY = /^[a-z][a-z0-9_-]{0,63}$/;

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

const { failed, problems } = await buildDraft(target);

if (failed) {
  fail(problems.join("\n"));
}

// Relative paths: the file tools take paths under the profile workspace.
const draft = path.join("plugin-drafts", id);

const edit = [...sources.keys()]
  .flatMap((entry) => {
    const file = fill(entry.slice(0, -".tmpl".length));

    const editable =
      (file.startsWith("src/") || file.endsWith(".json")) &&
      !(file.endsWith(".d.ts") || file.endsWith(".md"));

    return editable ? [file] : [];
  })
  .sort();

console.log(`Created ${draft} and built it.`);

console.log(`Edit: ${edit.map((entry) => `${draft}/${entry}`).join(", ")}`);

if (problems.length) {
  console.log("Still template text (replace before submit):");

  for (const problem of problems) {
    console.log(`- ${problem}`);
  }
}

console.log(
  `Rebuild and check: bun ${path.join(skillDir, "scripts", "build-plugin.mjs")} ${id}`
);
