import { join } from "node:path";
import type { OrgMemoryChangeLogEntry } from "../contract";
import { pathExists, readDirectoryEntries, readText, writePrivateTextFile } from "../fs";
import { getOrgMemoryHistoryDir } from "./resolve";

export const ORG_MEMORY_HISTORY_MAX_ENTRIES = 50;

export interface OrgMemoryChangeLogRecord extends OrgMemoryChangeLogEntry {
  content: string;
}

function historyMetaPath(orgId: string, id: string, configDir?: string): string {
  return join(getOrgMemoryHistoryDir(orgId, configDir), `${id}.json`);
}

function historyContentPath(orgId: string, id: string, configDir?: string): string {
  return join(getOrgMemoryHistoryDir(orgId, configDir), `${id}.md`);
}

export function createOrgMemoryChangeId(): string {
  return `omh_${crypto.randomUUID().replace(/-/g, "")}`;
}

export async function appendOrgMemoryHistory(
  orgId: string,
  entry: OrgMemoryChangeLogEntry,
  content: string,
  configDir?: string,
): Promise<void> {
  const historyDir = getOrgMemoryHistoryDir(orgId, configDir);
  await writePrivateTextFile(
    historyMetaPath(orgId, entry.id, configDir),
    `${JSON.stringify(entry, null, 2)}\n`,
    {
      ensureDir: historyDir,
    },
  );
  await writePrivateTextFile(historyContentPath(orgId, entry.id, configDir), content, {
    ensureDir: historyDir,
  });
  await pruneOrgMemoryHistory(orgId, ORG_MEMORY_HISTORY_MAX_ENTRIES, configDir);
}

export async function listOrgMemoryHistory(
  orgId: string,
  limit = ORG_MEMORY_HISTORY_MAX_ENTRIES,
  configDir?: string,
): Promise<OrgMemoryChangeLogEntry[]> {
  const historyDir = getOrgMemoryHistoryDir(orgId, configDir);
  if (!(await pathExists(historyDir))) {
    return [];
  }

  const entries = await readDirectoryEntries(historyDir);
  const ids = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.replace(/\.json$/, ""))
    .sort((left, right) => right.localeCompare(left));

  const records: OrgMemoryChangeLogEntry[] = [];
  for (const id of ids) {
    if (records.length >= limit) {
      break;
    }
    const raw = await readText(historyMetaPath(orgId, id, configDir));
    records.push(JSON.parse(raw) as OrgMemoryChangeLogEntry);
  }

  records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return records.slice(0, limit);
}

export async function getOrgMemoryHistoryEntry(
  orgId: string,
  revisionId: string,
  configDir?: string,
): Promise<OrgMemoryChangeLogRecord | null> {
  const metaPath = historyMetaPath(orgId, revisionId, configDir);
  const contentPath = historyContentPath(orgId, revisionId, configDir);
  if (!(await pathExists(metaPath)) || !(await pathExists(contentPath))) {
    return null;
  }

  const entry = JSON.parse(await readText(metaPath)) as OrgMemoryChangeLogEntry;
  const content = await readText(contentPath);
  return { ...entry, content };
}

export async function pruneOrgMemoryHistory(
  orgId: string,
  maxEntries: number,
  configDir?: string,
): Promise<void> {
  const historyDir = getOrgMemoryHistoryDir(orgId, configDir);
  if (!(await pathExists(historyDir))) {
    return;
  }

  const entries = await listOrgMemoryHistory(orgId, Number.MAX_SAFE_INTEGER, configDir);
  const stale = entries.slice(maxEntries);
  if (stale.length === 0) {
    return;
  }

  const { unlink } = await import("node:fs/promises");
  for (const entry of stale) {
    await unlink(historyMetaPath(orgId, entry.id, configDir)).catch(() => undefined);
    await unlink(historyContentPath(orgId, entry.id, configDir)).catch(() => undefined);
  }
}
