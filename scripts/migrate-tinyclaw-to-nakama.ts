#!/usr/bin/env bun
/**
 * Migrate a TinyClaw config directory to ~/.nakama.
 *
 * Usage:
 *   bun run scripts/migrate-tinyclaw-to-nakama.ts
 *   bun run scripts/migrate-tinyclaw-to-nakama.ts --dry-run
 */

import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Database } from "bun:sqlite";

const LEGACY_DIR_NAME = ".tinyclaw";
const TARGET_DIR_NAME = ".nakama";

function getSourceDir(): string {
  const override = process.env.TINYCLAW_CONFIG_DIR?.trim();
  if (override) {
    return override;
  }

  return join(homedir(), LEGACY_DIR_NAME);
}

function getTargetDir(): string {
  const override = process.env.NAKAMA_CONFIG_DIR?.trim();
  if (override) {
    return override;
  }

  return join(homedir(), TARGET_DIR_NAME);
}

const TEXT_EXTENSIONS = new Set([
  ".ini",
  ".json",
  ".txt",
  ".md",
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".env",
  ".yaml",
  ".yml",
]);

interface Options {
  dryRun: boolean;
  merge: boolean;
}

function parseArgs(argv: string[]): Options {
  let dryRun = false;
  let merge = false;

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--merge") {
      merge = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { dryRun, merge };
}

function printHelp(): void {
  console.log(`Migrate ${LEGACY_DIR_NAME} to ${TARGET_DIR_NAME}

Usage:
  bun run scripts/migrate-tinyclaw-to-nakama.ts [options]
  bun run migrate:tinyclaw

Environment:
  TINYCLAW_CONFIG_DIR   Legacy config root (default: ~/.tinyclaw)
  NAKAMA_CONFIG_DIR     Nakama config root (default: ~/.nakama)

Docker example:
  docker run --rm \\
    -v "$HOME/.tinyclaw:/root/.tinyclaw:ro" \\
    -v nakama-config:/root/.nakama \\
    ghcr.io/ahmadrosid/nakama:latest \\
    bun run migrate:tinyclaw

Options:
  --dry-run         Print planned actions without changing files
  --merge           Merge into an existing destination instead of deleting it first
  -h, --help        Show this help
`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function copyTree(source: string, dest: string, dryRun: boolean): Promise<void> {
  await mkdir(dest, { recursive: true, mode: 0o700 });
  const entries = await readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyTree(sourcePath, destPath, dryRun);
      continue;
    }

    if (!entry.isFile()) {
      console.log(`  skip  ${sourcePath} (not a regular file)`);
      continue;
    }

    logAction(dryRun, "copy", `${sourcePath} -> ${destPath}`);
    if (!dryRun) {
      await mkdir(dirname(destPath), { recursive: true, mode: 0o700 });
      await copyFile(sourcePath, destPath);
      const stat = await lstat(sourcePath);
      await chmod(destPath, stat.mode);
    }
  }
}

function logAction(dryRun: boolean, verb: string, message: string): void {
  console.log(`${dryRun ? "plan" : verb}  ${message}`);
}

async function renameIfExists(
  from: string,
  to: string,
  dryRun: boolean,
): Promise<boolean> {
  if (!(await pathExists(from))) {
    return false;
  }

  if (await pathExists(to)) {
    console.log(`  skip  ${from} (destination already exists: ${to})`);
    return false;
  }

  logAction(dryRun, "rename", `${from} -> ${to}`);
  if (!dryRun) {
    await mkdir(dirname(to), { recursive: true, mode: 0o700 });
    await rename(from, to);
  }

  return true;
}

async function removeDestIfPresent(dest: string, dryRun: boolean): Promise<boolean> {
  if (!(await pathExists(dest))) {
    return false;
  }

  logAction(dryRun, "remove", `${dest} (existing destination)`);
  if (!dryRun) {
    await rm(dest, { recursive: true, force: true });
  }

  return true;
}

async function removeIfEmpty(path: string, dryRun: boolean): Promise<void> {
  if (!(await pathExists(path))) {
    return;
  }

  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > 0) {
    return;
  }

  logAction(dryRun, "remove", `${path} (empty legacy file)`);
  if (!dryRun) {
    await rm(path, { force: true });
  }
}

function rewriteLegacyText(content: string): string {
  return content
    .replaceAll("~/.tinyclaw", "~/.nakama")
    .replaceAll(".tinyclaw/", ".nakama/")
    .replaceAll(".tinyclaw", ".nakama")
    .replaceAll("# TinyClaw", "# Nakama")
    .replaceAll("TINYCLAW_", "NAKAMA_")
    .replaceAll("tinyclaw_", "nakama_");
}

function isTextFile(path: string): boolean {
  const extension = basename(path).includes(".")
    ? `.${basename(path).split(".").pop()!.toLowerCase()}`
    : "";
  return TEXT_EXTENSIONS.has(extension);
}

async function rewriteTextFiles(root: string, dryRun: boolean): Promise<void> {
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.pop()!;
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = join(current, entry.name);

      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }

      if (!entry.isFile() || !isTextFile(absolutePath)) {
        continue;
      }

      const original = await readFile(absolutePath, "utf8");
      const rewritten = rewriteLegacyText(original);

      if (rewritten === original) {
        continue;
      }

      logAction(dryRun, "rewrite", absolutePath);
      if (!dryRun) {
        await writeFile(absolutePath, rewritten, { mode: 0o600 });
      }
    }
  }
}

async function migrateLayout(root: string, dryRun: boolean): Promise<void> {
  await renameIfExists(
    join(root, "data", "sqlite", "tinyclaw.sqlite"),
    join(root, "data", "sqlite", "nakama.sqlite"),
    dryRun,
  );
  await removeIfEmpty(join(root, "tinyclaw.db"), dryRun);
  await rewriteTextFiles(root, dryRun);
  await migrateSqliteData(root, dryRun);
}

const LEGACY_LOCAL_CLIENT_EMAIL = "local-client@tinyclaw.internal";
const TARGET_LOCAL_CLIENT_EMAIL = "local-client@nakama.internal";
const LOCAL_CLIENT_USER_ID = "user_local_client";

async function migrateSqliteData(root: string, dryRun: boolean): Promise<void> {
  const databasePath = join(root, "data", "sqlite", "nakama.sqlite");
  if (!(await pathExists(databasePath))) {
    return;
  }

  logAction(
    dryRun,
    "sql",
    `${databasePath} (update local client email)`,
  );

  if (dryRun) {
    return;
  }

  const database = new Database(databasePath);
  try {
    database
      .prepare(
        `
        UPDATE users
        SET email = ?
        WHERE id = ? AND email = ?
      `,
      )
      .run(TARGET_LOCAL_CLIENT_EMAIL, LOCAL_CLIENT_USER_ID, LEGACY_LOCAL_CLIENT_EMAIL);
  } finally {
    database.close();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const sourceDir = getSourceDir();
  const targetDir = getTargetDir();

  if (!(await pathExists(sourceDir))) {
    throw new Error(`Legacy config directory not found: ${sourceDir}`);
  }

  const destExists = await pathExists(targetDir);

  console.log(`Source: ${sourceDir}`);
  console.log(`Dest:   ${targetDir}`);
  if (options.dryRun) {
    console.log("Mode:   dry-run");
  }

  if (destExists && options.merge) {
    logAction(options.dryRun, "merge", `${sourceDir} -> ${targetDir}`);
    if (!options.dryRun) {
      await copyTree(sourceDir, targetDir, false);
    }
  } else {
    await removeDestIfPresent(targetDir, options.dryRun);
    logAction(options.dryRun, "copy", `${sourceDir} -> ${targetDir}`);
    if (!options.dryRun) {
      await copyTree(sourceDir, targetDir, false);
    }
  }

  const layoutRoot = (await pathExists(targetDir)) ? targetDir : sourceDir;
  await migrateLayout(layoutRoot, options.dryRun);

  console.log("");
  if (options.dryRun) {
    console.log("Dry run complete. Re-run without --dry-run to apply.");
  } else {
    console.log(`Migration complete. Nakama config is now at ${targetDir}.`);
    console.log(`Legacy config left in place at ${sourceDir}.`);
    console.log("Restart any running Nakama server, CLI, or platform workers.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
