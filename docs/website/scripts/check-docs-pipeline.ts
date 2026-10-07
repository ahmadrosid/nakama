import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readContentPages } from "./content-inventory";

const scriptsDirectory = path.dirname(new URL(import.meta.url).pathname);
const websiteDirectory = path.join(scriptsDirectory, "..");
const contentDirectory = path.join(websiteDirectory, "content", "docs");
const screenshotsDirectory = path.join(websiteDirectory, "public", "screenshots");
const packageJson = JSON.parse(
  await readFile(path.join(websiteDirectory, "package.json"), "utf8")
) as { scripts: Record<string, string> };

const failures: string[] = [];

function fail(message: string) {
  failures.push(message);
}

async function collectRegisteredPages(
  directory: string,
  base = ""
): Promise<Set<string>> {
  const registered = new Set<string>();
  const childNames = new Set(
    (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  );
  const metaPath = path.join(directory, "meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8")) as {
    pages: string[];
  };
  for (const page of meta.pages) {
    if (page.startsWith("---")) {
      continue;
    }
    if (childNames.has(page)) {
      continue;
    }
    const prefix = base ? `${base}/` : "";
    registered.add(
      page === "index" ? `${prefix}index.mdx` : `${prefix}${page}.mdx`
    );
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const child = await collectRegisteredPages(
        path.join(directory, entry.name),
        base ? `${base}/${entry.name}` : entry.name
      );
      for (const page of child) {
        registered.add(page);
      }
    }
  }
  return registered;
}

const contentPages = await readContentPages(contentDirectory);
const actualPages = new Set(contentPages.map((page) => page.mdxPath));
const registeredPages = await collectRegisteredPages(contentDirectory);

for (const page of actualPages) {
  if (!registeredPages.has(page)) {
    fail(`Content page is missing from meta.json: ${page}`);
  }
}
for (const page of registeredPages) {
  if (!actualPages.has(page)) {
    fail(`meta.json registers a missing content page: ${page}`);
  }
}

const screenshotReferences = new Set<string>();
for (const page of contentPages) {
  for (const match of page.markdown.matchAll(
    /\/screenshots\/([A-Za-z0-9._/-]+)/g
  )) {
    screenshotReferences.add(match[1]);
  }
}
const screenshotFiles = new Set(
  (await readdir(screenshotsDirectory)).filter((file) => file.endsWith(".png"))
);
for (const reference of screenshotReferences) {
  if (!screenshotFiles.has(reference)) {
    fail(`Documentation references a missing screenshot: /screenshots/${reference}`);
  }
}

const captureScripts = (await readdir(scriptsDirectory)).filter(
  (file) =>
    file !== "capture-common.sh" &&
    file.startsWith("capture-") &&
    file.endsWith(".sh")
);
for (const script of captureScripts) {
  const source = await readFile(path.join(scriptsDirectory, script), "utf8");
  if (!source.includes('ensure_current_web_build "$ROOT"')) {
    fail(`${script} does not ensure a current web build`);
  }
  if (script !== "capture-automation-profile-select-screenshots.sh") {
    for (const match of source.matchAll(
      /\$SCREENSHOT_DIR\/([A-Za-z0-9._/-]+)/g
    )) {
      if (!screenshotFiles.has(match[1])) {
        fail(`${script} writes a missing screenshot: ${match[1]}`);
      }
    }
  }
  if (source.includes('open "${BASE_URL}/integrations"')) {
    fail(`${script} still opens the removed Integrations landing route`);
  }
  if (source.includes("/integrations?section=")) {
    fail(`${script} still uses the old Integrations query route`);
  }
}

const siteMeta = await readFile(
  path.join(websiteDirectory, "lib", "site-meta.ts"),
  "utf8"
);
if (siteMeta.includes("pageDescriptions") || siteMeta.includes("pageTitles")) {
  fail("site-meta.ts still contains duplicate page metadata maps");
}
if (siteMeta.includes('"telegram.md"')) {
  fail("site-meta.ts still emits the stale telegram.md path");
}

const requiredCommands = [
  "screenshots:error-tracking",
  "screenshots:mcp",
  "check:pipeline",
];
for (const command of requiredCommands) {
  if (!packageJson.scripts[command]) {
    fail(`Missing package command: ${command}`);
  }
}

if (failures.length > 0) {
  console.error(
    failures.map((failure) => `Docs pipeline check failed: ${failure}`).join("\n")
  );
  process.exit(1);
}

console.log(
  `Docs pipeline check passed: ${actualPages.size} pages, ${screenshotReferences.size} referenced screenshots, ${captureScripts.length} capture scripts`
);
