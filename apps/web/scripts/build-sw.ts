/**
 * Bundles the service worker after `vite build`, stamping it with the build's
 * precache list so the worker ships the exact chunk names it must cache.
 */
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import {
  buildVersion,
  precacheUrls,
  type ViteManifest,
} from "../src/lib/sw-precache";

/** Unhashed files the shell needs on a cold, offline start. */
const EXTRA_PRECACHE_URLS = ["/manifest.webmanifest", "/icons/icon-192.png"];

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const distDir = join(webRoot, "dist");

const viteManifestPath = join(distDir, ".vite/manifest.json");

await typeCheckWorker();

const manifestFile = Bun.file(viteManifestPath);

if (!(await manifestFile.exists())) {
  console.error(
    `build-sw: ${viteManifestPath} is missing. Run \`vite build\` with \`build.manifest\` enabled first.`
  );
  process.exit(1);
}

// SAFETY: Vite generates this manifest with the ViteManifest shape during the build.
const manifest = (await manifestFile.json()) as ViteManifest;

const precache = precacheUrls(manifest, EXTRA_PRECACHE_URLS);

const version = buildVersion(precache);

const result = await Bun.build({
  define: {
    __SW_PRECACHE__: JSON.stringify(precache),
    __SW_VERSION__: JSON.stringify(version),
  },
  entrypoints: [join(webRoot, "sw/service-worker.ts")],
  format: "iife",
  minify: true,
  target: "browser",
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }

  process.exit(1);
}

const [bundle] = result.outputs;

if (!bundle) {
  console.error("build-sw: the bundler produced no output.");
  process.exit(1);
}

await Bun.write(join(distDir, "sw.js"), await bundle.text());

// Vite only writes the manifest so this script can read it; serving it would
// publish the chunk graph for no reason.
await rm(join(distDir, ".vite"), { force: true, recursive: true });

console.log(`build-sw: sw.js v${version} precaching ${precache.length} files.`);

async function typeCheckWorker(): Promise<void> {
  const check = Bun.spawn(
    ["bun", "x", "tsc", "-p", join(webRoot, "tsconfig.sw.json"), "--noEmit"],
    { cwd: webRoot, stderr: "inherit", stdout: "inherit" }
  );

  const exitCode = await check.exited;

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

// Ship the unpacked Chrome extension independently of the retired plugin workspace.
const extensionDir = join(webRoot, "public/google-meet-extension");

const extensionFiles: Record<string, Uint8Array> = {};

await Promise.all(
  (await readdir(extensionDir)).map(async (file) => {
    extensionFiles[`google-meet-extension/${file}`] = await readFile(
      join(extensionDir, file)
    );
  })
);

await writeFile(
  join(distDir, "google-meet-extension.zip"),
  zipSync(extensionFiles)
);
