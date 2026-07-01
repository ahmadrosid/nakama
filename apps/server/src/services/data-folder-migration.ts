import { rename, rm, rmdir } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  getUserConfigDir,
  pathExists,
  readDirectoryEntries,
  readTextOrNull,
} from "@tinyclaw/core";
import type {
  DataFolderMigrationLogEntry,
  DataFolderMigrationResponse,
} from "@tinyclaw/core";

interface RunDataFolderMigrationOptions {
  configRoot?: string;
  now?: Date;
}

interface MigrationState {
  organizationsScanned: number;
  profilesScanned: number;
  profilesChanged: number;
  filesMoved: number;
  foldersRemoved: number;
  logs: DataFolderMigrationLogEntry[];
}

export async function runDataFolderMigration(
  options: RunDataFolderMigrationOptions = {},
): Promise<DataFolderMigrationResponse> {
  const startedAt = (options.now ?? new Date()).toISOString();
  const configRoot = options.configRoot ?? getUserConfigDir();
  const orgsRoot = join(configRoot, "orgs");
  const state: MigrationState = {
    organizationsScanned: 0,
    profilesScanned: 0,
    profilesChanged: 0,
    filesMoved: 0,
    foldersRemoved: 0,
    logs: [],
  };

  log(state, "info", `Scanning config root: ${configRoot}`);

  if (!(await pathExists(orgsRoot))) {
    log(state, "warn", "No orgs directory found. Nothing to migrate.");
    return finish(state, startedAt, configRoot);
  }

  const orgEntries = (await readDirectoryEntries(orgsRoot))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  state.organizationsScanned = orgEntries.length;

  for (const orgEntry of orgEntries) {
    const orgId = orgEntry.name;
    const profilesRoot = join(orgsRoot, orgId, "profiles");

    if (!(await pathExists(profilesRoot))) {
      log(state, "warn", `Org ${orgId}: missing profiles directory, skipping.`);
      continue;
    }

    const profileEntries = (await readDirectoryEntries(profilesRoot))
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    log(state, "info", `Org ${orgId}: found ${profileEntries.length} profile(s).`);

    for (const profileEntry of profileEntries) {
      const profileId = profileEntry.name;
      const profileDir = join(profilesRoot, profileId);
      const changed = await migrateProfile(orgId, profileId, profileDir, state);
      state.profilesScanned += 1;
      if (changed) {
        state.profilesChanged += 1;
      }
    }
  }

  return finish(state, startedAt, configRoot);
}

async function migrateProfile(
  orgId: string,
  profileId: string,
  profileDir: string,
  state: MigrationState,
): Promise<boolean> {
  let changed = false;
  log(state, "info", `Profile ${orgId}/${profileId}: checking data folders.`);

  changed = (await migrateKnowledgeBase(profileDir, state)) || changed;
  changed = (await migrateMemoryArchive(profileDir, state)) || changed;
  changed = (await removeDirIfEmpty(join(profileDir, "data"), state, "Removed empty data/ folder.")) || changed;

  if (changed) {
    log(state, "success", `Profile ${orgId}/${profileId}: migration complete.`);
  } else {
    log(state, "info", `Profile ${orgId}/${profileId}: already up to date.`);
  }

  return changed;
}

async function migrateKnowledgeBase(profileDir: string, state: MigrationState): Promise<boolean> {
  let changed = false;
  const currentDir = join(profileDir, "knowledge-base");
  const legacyDir = join(profileDir, "data", "knowledge-base");

  if (await pathExists(legacyDir)) {
    if (!(await pathExists(currentDir))) {
      await rename(legacyDir, currentDir);
      log(state, "success", `Moved ${relativeProfilePath(profileDir, legacyDir)} to knowledge-base/.`);
      changed = true;
    } else {
      log(state, "info", "Merging legacy data/knowledge-base into knowledge-base/.");
      changed = (await mergeLegacyKnowledgeBaseRootFiles(legacyDir, currentDir, state)) || changed;
      changed = (await flattenExtractedDir(legacyDir, currentDir, state)) || changed;
      changed = (await flattenUploadsDir(legacyDir, currentDir, state)) || changed;
      changed = (await removeDirIfEmpty(legacyDir, state, "Removed empty data/knowledge-base/ folder.")) || changed;
    }
  }

  if (!(await pathExists(currentDir))) {
    return changed;
  }

  changed = (await flattenExtractedDir(currentDir, currentDir, state)) || changed;
  changed = (await flattenUploadsDir(currentDir, currentDir, state)) || changed;
  return changed;
}

async function mergeLegacyKnowledgeBaseRootFiles(
  legacyDir: string,
  currentDir: string,
  state: MigrationState,
): Promise<boolean> {
  let changed = false;
  const entries = (await readDirectoryEntries(legacyDir)).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const sourcePath = join(legacyDir, entry.name);
    const targetPath = join(currentDir, entry.name);
    if (await pathExists(targetPath)) {
      continue;
    }

    await rename(sourcePath, targetPath);
    state.filesMoved += 1;
    changed = true;
    log(state, "success", `Moved legacy knowledge-base file ${entry.name}.`);
  }

  return changed;
}

async function flattenExtractedDir(
  sourceKnowledgeBaseDir: string,
  targetKnowledgeBaseDir: string,
  state: MigrationState,
): Promise<boolean> {
  const extractedDir = join(sourceKnowledgeBaseDir, "extracted");
  if (!(await pathExists(extractedDir))) {
    return false;
  }

  let changed = false;
  const entries = (await readDirectoryEntries(extractedDir)).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const sourcePath = join(extractedDir, entry.name);
    if (!entry.isFile()) {
      log(state, "warn", `Skipped non-file legacy extracted entry: ${sourcePath}`);
      continue;
    }

    const documentId = entry.name.replace(/\.txt$/i, "");
    const targetPath = join(targetKnowledgeBaseDir, `${documentId}.extracted.txt`);
    if (await pathExists(targetPath)) {
      log(state, "warn", `Kept existing ${basename(targetPath)} and skipped duplicate legacy extracted file ${entry.name}.`);
      continue;
    }

    await rename(sourcePath, targetPath);
    state.filesMoved += 1;
    changed = true;
    log(state, "success", `Moved extracted file ${entry.name} -> ${basename(targetPath)}.`);
  }

  changed = (await removeDirIfEmpty(extractedDir, state, "Removed empty knowledge-base/extracted/ folder.")) || changed;
  return changed;
}

async function flattenUploadsDir(
  sourceKnowledgeBaseDir: string,
  targetKnowledgeBaseDir: string,
  state: MigrationState,
): Promise<boolean> {
  const uploadsDir = join(sourceKnowledgeBaseDir, "uploads");
  if (!(await pathExists(uploadsDir))) {
    return false;
  }

  let changed = false;
  const entries = (await readDirectoryEntries(uploadsDir)).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const entryPath = join(uploadsDir, entry.name);

    if (!entry.isDirectory()) {
      log(state, "warn", `Skipped unexpected legacy upload entry: ${entryPath}`);
      continue;
    }

    const documentId = entry.name;
    const files = (await readDirectoryEntries(entryPath)).sort((a, b) => a.name.localeCompare(b.name));

    for (const file of files) {
      const sourcePath = join(entryPath, file.name);
      if (!file.isFile()) {
        log(state, "warn", `Skipped non-file legacy upload entry: ${sourcePath}`);
        continue;
      }

      const targetPath = join(targetKnowledgeBaseDir, `${documentId}--${sanitizeFilename(file.name)}`);
      if (await pathExists(targetPath)) {
        log(state, "warn", `Kept existing ${basename(targetPath)} and skipped duplicate legacy upload ${file.name}.`);
        continue;
      }

      await rename(sourcePath, targetPath);
      state.filesMoved += 1;
      changed = true;
      log(state, "success", `Moved upload ${file.name} -> ${basename(targetPath)}.`);
    }

    changed = (await removeDirIfEmpty(entryPath, state, `Removed empty legacy upload folder uploads/${documentId}/.`)) || changed;
  }

  changed = (await removeDirIfEmpty(uploadsDir, state, "Removed empty knowledge-base/uploads/ folder.")) || changed;
  return changed;
}

async function migrateMemoryArchive(profileDir: string, state: MigrationState): Promise<boolean> {
  let changed = false;
  const currentDir = join(profileDir, "memory-archive");
  const legacyDir = join(profileDir, "data", "memory-archive");

  if (!(await pathExists(legacyDir))) {
    return false;
  }

  if (!(await pathExists(currentDir))) {
    await rename(legacyDir, currentDir);
    log(state, "success", "Moved data/memory-archive to memory-archive/.");
    return true;
  }

  const entries = (await readDirectoryEntries(legacyDir)).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const sourcePath = join(legacyDir, entry.name);
    const targetPath = join(currentDir, entry.name);

    if (!entry.isFile()) {
      log(state, "warn", `Skipped non-file legacy memory archive entry: ${sourcePath}`);
      continue;
    }

    if (await pathExists(targetPath)) {
      const sourceText = await readTextOrNull(sourcePath);
      const targetText = await readTextOrNull(targetPath);
      if (sourceText !== null && sourceText === targetText) {
        await rm(sourcePath, { force: true });
        log(state, "info", `Removed duplicate legacy memory archive file ${entry.name}.`);
        changed = true;
        continue;
      }

      log(state, "warn", `Kept existing memory archive ${entry.name}; legacy copy was left in place for manual review.`);
      continue;
    }

    await rename(sourcePath, targetPath);
    state.filesMoved += 1;
    changed = true;
    log(state, "success", `Moved memory archive ${entry.name} into memory-archive/.`);
  }

  changed = (await removeDirIfEmpty(legacyDir, state, "Removed empty data/memory-archive/ folder.")) || changed;
  return changed;
}

async function removeDirIfEmpty(
  directory: string,
  state: MigrationState,
  message: string,
): Promise<boolean> {
  if (!(await pathExists(directory))) {
    return false;
  }

  const entries = await readDirectoryEntries(directory);
  if (entries.length > 0) {
    return false;
  }

  await rmdir(directory);
  state.foldersRemoved += 1;
  log(state, "success", message);
  return true;
}

function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop()?.trim() ?? "document";
  return base.replace(/[^\w.\-() ]+/g, "_") || "document";
}

function relativeProfilePath(profileDir: string, targetPath: string): string {
  return targetPath.startsWith(profileDir) ? targetPath.slice(profileDir.length + 1) : targetPath;
}

function log(state: MigrationState, level: DataFolderMigrationLogEntry["level"], message: string): void {
  state.logs.push({ level, message });
}

function finish(
  state: MigrationState,
  startedAt: string,
  configRoot: string,
): DataFolderMigrationResponse {
  const finishedAt = new Date().toISOString();
  log(
    state,
    "success",
    `Done. Scanned ${state.profilesScanned} profile(s), changed ${state.profilesChanged}, moved ${state.filesMoved} file(s), removed ${state.foldersRemoved} folder(s).`,
  );

  return {
    startedAt,
    finishedAt,
    configRoot,
    organizationsScanned: state.organizationsScanned,
    profilesScanned: state.profilesScanned,
    profilesChanged: state.profilesChanged,
    filesMoved: state.filesMoved,
    foldersRemoved: state.foldersRemoved,
    logs: state.logs,
  };
}
