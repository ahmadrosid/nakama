// Build a plugin draft and check it before submit_plugin_draft.
// Usage (from the profile workspace): bun build-plugin.mjs <plugin-id>
// It checks the manifest with the host's rules, bundles every action, worker,
// and the page from src/, and lints the page against the Nakama style rules.
// It prints every problem at once, so one fix round is enough.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const PLUGIN_ID = /^[a-z][a-z0-9-]*$/;

const KEY = /^[a-z][a-z0-9_-]*$/;

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const OFFICIAL_IDS = new Set([
  "data-view",
  "google-meet",
  "supermemory",
  "workflows",
]);

const SCHEMA_KEYWORDS = new Set([
  "additionalProperties",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "items",
  "maxItems",
  "maximum",
  "maxLength",
  "minItems",
  "minimum",
  "minLength",
  "properties",
  "required",
  "type",
]);

const SCHEMA_TYPES = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
]);

const SOURCE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs"];

// Text the templates ship. A draft that still has it was not finished.
const TEMPLATE_TEXT = [
  [/^.+ plugin\.$/, "description: replace the template text"],
  [/^Greet a person by name\.$/, "description: replace the example action"],
];

function isText(value) {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This script is the manifest parse boundary; it runs from the installed skill copy and cannot import zod.
  return typeof value === "string" && value.trim().length > 0;
}

function isRelative(value) {
  return (
    isText(value) &&
    !(value.startsWith("/") || value.includes("\\") || value.includes(":")) &&
    value.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

async function exists(file) {
  return Boolean(await stat(file).catch(() => null));
}

async function readJson(file, problems) {
  let text;

  try {
    text = await readFile(file, "utf8");
  } catch {
    problems.push(`${path.basename(file)}: file is missing`);

    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    // Bun's JSON errors have no position. Hand edits mostly leave a double or
    // trailing comma, so point at that line when there is one.
    const slip = /,(\s*)[,}\]]/.exec(text);
    const where = slip ? `:${lineOf(text, slip.index)}` : "";
    const hint = slip ? ": extra comma" : "";

    problems.push(
      `${path.basename(file)}${where}: invalid JSON (${error.message})${hint}`
    );

    return null;
  }
}

function checkSchema(schema, where, problems) {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This script is the manifest parse boundary; it runs from the installed skill copy and cannot import zod.
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    problems.push(`${where}: must be an object`);

    return;
  }

  for (const [keyword, value] of Object.entries(schema)) {
    if (!SCHEMA_KEYWORDS.has(keyword)) {
      problems.push(
        `${where}.${keyword}: not supported. Remove it; describe inputs in the action description and apply defaults in run()`
      );
      continue;
    }

    if (keyword === "properties") {
      for (const [name, child] of Object.entries(value ?? {})) {
        checkSchema(child, `${where}.properties.${name}`, problems);
      }
    } else if (keyword === "items") {
      checkSchema(value, `${where}.items`, problems);
    } else if (keyword === "additionalProperties") {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This script is the manifest parse boundary; it runs from the installed skill copy and cannot import zod.
      if (typeof value !== "boolean") {
        checkSchema(value, `${where}.additionalProperties`, problems);
      }
    } else if (keyword === "type") {
      const types = Array.isArray(value) ? value : [value];

      if (!(types.length && types.every((type) => SCHEMA_TYPES.has(type)))) {
        problems.push(`${where}.type: unknown type ${JSON.stringify(value)}`);
      }
    } else if (keyword === "required" || keyword === "enum") {
      if (!(Array.isArray(value) && value.length)) {
        problems.push(`${where}.${keyword}: must be a non-empty array`);
      }
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This script is the manifest parse boundary; it runs from the installed skill copy and cannot import zod.
    } else if (typeof value !== "number" || !Number.isFinite(value)) {
      problems.push(`${where}.${keyword}: must be a number`);
    }
  }
}

function checkKeys(list, where, problems) {
  const seen = new Set();

  for (const [index, item] of list.entries()) {
    if (!(isText(item?.key) && KEY.test(item.key))) {
      problems.push(
        `${where}[${index}].key: use lowercase letters, digits, - or _`
      );
    } else if (seen.has(item.key)) {
      problems.push(`${where}[${index}].key: duplicate "${item.key}"`);
    }

    seen.add(item?.key);
  }
}

/** Every problem the host would reject at submit, in plain words. */
function checkManifest(manifest, packageJson, draftId) {
  const problems = [];
  const m = manifest;

  if (m.apiVersion !== 1) {
    problems.push("apiVersion: must be 1");
  }

  if (m.id !== draftId) {
    problems.push(`id: must be "${draftId}", the draft folder name`);
  } else if (!PLUGIN_ID.test(m.id) || OFFICIAL_IDS.has(m.id)) {
    problems.push(`id: "${m.id}" is not allowed`);
  }

  for (const field of ["name", "description", "author", "license"]) {
    if (!isText(m[field])) {
      problems.push(`${field}: required`);
    }
  }

  if (isText(m.description) && TEMPLATE_TEXT[0][0].test(m.description)) {
    problems.push(TEMPLATE_TEXT[0][1]);
  }

  for (const field of ["version", "minNakamaVersion"]) {
    if (!(isText(m[field]) && SEMVER.test(m[field]))) {
      problems.push(`${field}: must be a version such as 1.0.0`);
    }
  }

  if (m.icon !== undefined && !String(m.icon).startsWith("https://")) {
    problems.push("icon: must be an https URL");
  }

  if (m.hooks !== undefined) {
    problems.push("hooks: not supported. Remove it");
  }

  if (packageJson) {
    if (packageJson.version !== m.version) {
      problems.push(
        `package.json version ${packageJson.version} must equal the manifest version ${m.version}`
      );
    }

    if (packageJson.type !== "module") {
      problems.push('package.json: set "type": "module"');
    }

    for (const field of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      if (Object.keys(packageJson[field] ?? {}).length) {
        problems.push(
          `package.json ${field}: remove; bundle libraries into the output`
        );
      }
    }
  }

  const actions = Array.isArray(m.actions) ? m.actions : [];

  if (m.actions !== undefined && !Array.isArray(m.actions)) {
    problems.push("actions: must be an array");
  }

  checkKeys(actions, "actions", problems);

  for (const [index, action] of actions.entries()) {
    const where = `actions[${index}] (${action?.key})`;

    if (!isText(action.description)) {
      problems.push(`${where}.description: required`);
    } else if (TEMPLATE_TEXT[1][0].test(action.description)) {
      problems.push(`${where}.${TEMPLATE_TEXT[1][1]}`);
    }

    if (!isRelative(action.entry)) {
      problems.push(
        `${where}.entry: use a relative path such as actions/${action.key}.js`
      );
    }

    if (action.access !== "member" && action.access !== "admin") {
      problems.push(`${where}.access: must be "member" or "admin"`);
    }

    if (action.effect !== "read" && action.effect !== "write") {
      problems.push(`${where}.effect: must be "read" or "write"`);
    }

    if (
      action.exposeAsTool !== undefined &&
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This script is the manifest parse boundary; it runs from the installed skill copy and cannot import zod.
      typeof action.exposeAsTool !== "boolean"
    ) {
      problems.push(`${where}.exposeAsTool: must be true or false`);
    }

    if (action.inputSchema === undefined) {
      problems.push(`${where}.inputSchema: required`);
    } else {
      checkSchema(action.inputSchema, `${where}.inputSchema`, problems);
    }
  }

  if (m.ui !== undefined) {
    if (!(isText(m.ui?.pageLabel) && isRelative(m.ui?.assetsDir))) {
      problems.push("ui: needs pageLabel and a relative assetsDir");
    }

    if (!(isRelative(m.ui?.entryModule) && /\.m?js$/.test(m.ui.entryModule))) {
      problems.push(
        "ui.entryModule: use a relative .js path such as ui/app.js"
      );
    }
  }

  const workers = Array.isArray(m.workers) ? m.workers : [];

  if (workers.length > 8) {
    problems.push("workers: at most 8");
  }

  checkKeys(workers, "workers", problems);

  for (const [index, worker] of workers.entries()) {
    if (!isText(worker.name)) {
      problems.push(`workers[${index}].name: required`);
    }

    if (!(isRelative(worker.entry) && /\.m?js$/.test(worker.entry))) {
      problems.push(`workers[${index}].entry: use a relative .js path`);
    }
  }

  const skills = Array.isArray(m.skills) ? m.skills : [];
  checkKeys(skills, "skills", problems);

  for (const [index, skill] of skills.entries()) {
    if (!isRelative(skill.directory)) {
      problems.push(`skills[${index}].directory: use a relative path`);
    }
  }

  const ids = new Set();

  for (const [index, migration] of (m.database?.migrations ?? []).entries()) {
    if (!(isText(migration.id) && isRelative(migration.path))) {
      problems.push(
        `database.migrations[${index}]: needs id and a relative path`
      );
    } else if (ids.has(migration.id)) {
      problems.push(
        `database.migrations[${index}].id: duplicate "${migration.id}"`
      );
    }

    ids.add(migration.id);
  }

  return problems;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function stripCssComments(css) {
  // Keep line breaks so reported line numbers stay right.
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " ")
  );
}

const JSX_RULES = [
  [
    /<h[1-6][\s>]/g,
    "remove the heading; the host shows pageLabel as the title",
  ],
  [
    /<(button|input|select|textarea|table)[\s>]/g,
    "use the ctx.ui component, not a plain HTML control",
  ],
  [
    /from\s+["'](react|react-dom|@nakama\/[^"']*)["']/g,
    "do not import React or Nakama packages; use ctx.React and ctx.ui",
  ],
  [
    /\b(const|let|var)\s+React\s*=/g,
    "do not shadow React; keep the template's module-level `let React` set in apply",
  ],
  [/\b(toast|cn)\(/g, "not available in plugins; see src/nakama-plugin.d.ts"],
  [
    /className="(?:[^"]*\s)?(?:flex|grid|gap|p[xytblr]?|m[xytblr]?|w|h|text|bg|border|rounded)-[a-z0-9]/g,
    "Tailwind classes do not work in plugins; use src/ui.css",
  ],
];

/** Page code that breaks the Nakama style rules in SKILL.md. */
function lintPage(file, source) {
  const problems = [];

  for (const [pattern, message] of JSX_RULES) {
    for (const match of source.matchAll(pattern)) {
      problems.push(`${file}:${lineOf(source, match.index)}: ${message}`);
    }
  }

  for (const match of source.matchAll(/<DialogContent\b/g)) {
    const tag = source
      .slice(match.index, match.index + 400)
      .split(/<(?!DialogContent)/)[0];

    if (!tag.includes("data-plugin-id")) {
      problems.push(
        `${file}:${lineOf(source, match.index)}: add data-plugin-id={ctx.pluginId} to DialogContent so plugin CSS reaches the dialog`
      );
    }
  }

  for (const match of source.matchAll(/<TableCell\b[\s\S]*?<\/TableCell>/g)) {
    const cell = match[0];

    if (/<Button\b/.test(cell) && !/variant="link"/.test(cell)) {
      problems.push(
        `${file}:${lineOf(source, match.index)}: no button columns; make the name cell a link Button that opens a dialog with the actions`
      );
    }
  }

  return problems;
}

/** CSS that breaks the scoping and token rules in SKILL.md. */
function lintCss(file, source, pluginId) {
  const problems = [];
  const css = stripCssComments(source);

  const rules = [
    [
      /#[0-9a-fA-F]{3,8}\b/g,
      "use a host color variable such as var(--primary), not a hex color",
    ],
    [/\b(rgba?|hsla?)\(/g, "use a host color variable, not a raw color"],
    [/gradient\(/g, "no gradients"],
    [/box-shadow\s*:(?!\s*none)/g, "no shadows; Nakama pages use borders"],
    [/\b9{3,}px/g, "no pill shapes; use var(--n-radius) or var(--n-radius-sm)"],
    [/text-transform\s*:\s*uppercase/g, "no all-caps labels"],
    [/letter-spacing\s*:/g, "no letter-spaced labels"],
  ];

  for (const [pattern, message] of rules) {
    for (const match of css.matchAll(pattern)) {
      problems.push(`${file}:${lineOf(css, match.index)}: ${message}`);
    }
  }

  // Every top-level rule must sit under this plugin's scope.
  let depth = 0;
  let start = 0;

  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];

    if (char === "{") {
      if (depth === 0) {
        const selector = css.slice(start, index).trim();

        if (
          !(
            selector.startsWith("@") ||
            selector.includes(`[data-plugin-id="${pluginId}"]`)
          )
        ) {
          problems.push(
            `${file}:${lineOf(css, index)}: nest "${selector}" under [data-plugin-id="${pluginId}"]`
          );
        }
      }

      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      start = index + 1;
    } else if (char === ";" && depth === 0) {
      start = index + 1;
    }
  }

  return problems;
}

// src/<name> builds to <dir>/<name>.js; the page is src/ui.jsx -> ui/app.js.
async function findSource(draft, name) {
  for (const extension of SOURCE_EXTENSIONS) {
    const file = path.join(draft, "src", name + extension);

    if (await exists(file)) {
      return file;
    }
  }

  return null;
}

/**
 * Check, bundle, and lint plugin-drafts/<id>. `failed` is true when a bundle
 * did not compile, apart from manifest and style problems.
 */
export async function buildDraft(draft) {
  const draftId = path.basename(draft);
  const problems = [];
  const built = [];
  let failed = false;

  const manifest = await readJson(
    path.join(draft, "nakama.plugin.json"),
    problems
  );

  const packageJson = await readJson(
    path.join(draft, "package.json"),
    problems
  );

  if (!manifest) {
    return { built, failed: true, problems };
  }

  problems.push(...checkManifest(manifest, packageJson, draftId));

  const base = (entry) => path.basename(String(entry)).replace(/\.m?js$/, "");

  const outputs = [
    ...(manifest.actions ?? []).map((item) => [
      item.entry,
      "bun",
      base(item.entry),
    ]),
    ...(manifest.workers ?? []).map((item) => [
      item.entry,
      "bun",
      base(item.entry),
    ]),
    ...(manifest.ui ? [[manifest.ui.entryModule, "browser", "ui"]] : []),
  ].filter(([entry]) => isRelative(entry));

  for (const [entry, target, name] of outputs) {
    const source = await findSource(draft, name);

    if (!source) {
      if (!(await exists(path.join(draft, entry)))) {
        problems.push(`${entry}: no source found at src/${name}.js`);
      }

      continue;
    }

    const result = await Bun.build({
      entrypoints: [source],
      naming: path.basename(entry),
      outdir: path.join(draft, path.dirname(entry)),
      target,
    });

    if (result.success) {
      built.push(entry);
    } else {
      failed = true;
      problems.push(
        `${path.relative(draft, source)}: build failed\n${result.logs.map(String).join("\n")}`
      );
    }
  }

  for (const migration of manifest.database?.migrations ?? []) {
    if (
      isRelative(migration.path) &&
      !(await exists(path.join(draft, migration.path)))
    ) {
      problems.push(`${migration.path}: migration file is missing`);
    }
  }

  for (const skill of manifest.skills ?? []) {
    if (
      isRelative(skill.directory) &&
      !(await exists(path.join(draft, skill.directory, "SKILL.md")))
    ) {
      problems.push(`${skill.directory}/SKILL.md: file is missing`);
    }
  }

  const srcDir = path.join(draft, "src");
  const files = (await exists(srcDir)) ? await readdir(srcDir) : [];

  for (const file of files) {
    const source = await readFile(path.join(srcDir, file), "utf8");

    if (/\.(jsx|tsx)$/.test(file)) {
      problems.push(...lintPage(`src/${file}`, source));
    } else if (file.endsWith(".css")) {
      problems.push(...lintCss(`src/${file}`, source, draftId));
    }
  }

  return { built, failed, problems };
}

function report(id, { built, problems }) {
  if (problems.length) {
    console.error(
      `plugin-drafts/${id}: ${problems.length} problem(s). Fix all of them, then run this again.`
    );

    for (const problem of problems) {
      console.error(`- ${problem}`);
    }

    return false;
  }

  console.log(
    `Built plugin-drafts/${id}: ${built.join(", ") || "nothing to build"}.`
  );

  return true;
}

if (import.meta.main) {
  const id = process.argv[2];

  if (!(id && PLUGIN_ID.test(id))) {
    console.error("Usage: bun build-plugin.mjs <plugin-id>");
    process.exit(1);
  }

  const draft = path.resolve("plugin-drafts", id);

  if (!(await exists(draft))) {
    console.error(`${draft} does not exist. Run from the profile workspace.`);
    process.exit(1);
  }

  if (report(id, await buildDraft(draft))) {
    console.log(`Next: call submit_plugin_draft with draftId "${id}".`);
  } else {
    process.exit(1);
  }
}
