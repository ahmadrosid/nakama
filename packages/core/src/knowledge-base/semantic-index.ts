import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeBaseDocument } from "../contract";
import { readTextOrNull, writeTextFile } from "../fs";
import {
  getKnowledgeBaseDir,
  getKnowledgeIndexEntryPath,
  getKnowledgeIndexMetaPath,
  getKnowledgeIndexPath,
  getOrgKnowledgeBaseDir,
} from "./paths";
import {
  getProfileSharedDocumentIds,
  listKnowledgeBaseDocuments,
  listOrganizationKnowledgeBaseDocuments,
  withKnowledgeIndexLock,
} from "./store";

export type KnowledgeIndexScope = "profile" | "organization";
export type KnowledgeIndexDocument = KnowledgeBaseDocument & {
  scope: KnowledgeIndexScope;
};

export interface KnowledgeIndexTopic {
  description: string;
  name: string;
  terms: string[];
}

interface KnowledgeIndexEntry {
  contentHash: string;
  documentId: string;
  partial: boolean;
  topics: KnowledgeIndexTopic[];
}

interface KnowledgeIndexMeta {
  hash: string;
  hasPartial: boolean;
  indexedCount: number;
  readyCount: number;
  revision: string;
}

export interface KnowledgeIndexStatus {
  indexedCount: number;
  readyCount: number;
  status: "missing" | "partial" | "ready" | "stale";
}

const MAX_INDEX_READ_BYTES = 1200;
const SETTINGS_FILE = "index-settings.json";

export async function isKnowledgeIndexEnabled(orgId: string): Promise<boolean> {
  const raw = await readTextOrNull(
    join(getOrgKnowledgeBaseDir(orgId), SETTINGS_FILE)
  );
  if (!raw) {
    return false;
  }
  try {
    return JSON.parse(raw).enabled === true;
  } catch {
    return false;
  }
}

export async function setKnowledgeIndexEnabled(
  orgId: string,
  enabled: boolean
): Promise<void> {
  await withKnowledgeIndexLock(orgId, () =>
    writeTextFile(
      join(getOrgKnowledgeBaseDir(orgId), SETTINGS_FILE),
      `${JSON.stringify({ enabled })}\n`
    )
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function indexRevision(documents: KnowledgeIndexDocument[]): string {
  return sha256(
    documents
      .map((document) =>
        [
          document.scope,
          document.id,
          document.status,
          document.contentHash ?? "",
        ].join(":")
      )
      .sort()
      .join("\n")
  );
}

export async function listAccessibleKnowledgeDocuments(
  orgId: string,
  profileId: string
): Promise<KnowledgeIndexDocument[]> {
  const [profileDocuments, organizationDocuments, attachedIds] =
    await Promise.all([
      listKnowledgeBaseDocuments(orgId, profileId),
      listOrganizationKnowledgeBaseDocuments(orgId),
      getProfileSharedDocumentIds(orgId, profileId),
    ]);
  const attached = new Set(attachedIds);
  return [
    ...profileDocuments.map((document) => ({
      ...document,
      scope: "profile" as const,
    })),
    ...organizationDocuments
      .filter((document) => attached.has(document.id))
      .map((document) => ({ ...document, scope: "organization" as const })),
  ];
}

function entryPath(
  orgId: string,
  scope: KnowledgeIndexScope,
  documentId: string,
  profileId: string
): string {
  const dir =
    scope === "organization"
      ? getOrgKnowledgeBaseDir(orgId)
      : getKnowledgeBaseDir(orgId, profileId);
  return getKnowledgeIndexEntryPath(dir, documentId);
}

async function readEntry(
  orgId: string,
  profileId: string,
  document: KnowledgeIndexDocument
): Promise<KnowledgeIndexEntry | null> {
  const raw = await readTextOrNull(
    entryPath(orgId, document.scope, document.id, profileId)
  );
  if (!raw) {
    return null;
  }
  try {
    const entry = JSON.parse(raw) as KnowledgeIndexEntry;
    return entry.documentId === document.id &&
      entry.contentHash === document.contentHash &&
      Array.isArray(entry.topics)
      ? entry
      : null;
  } catch {
    return null;
  }
}

export async function hasKnowledgeIndexEntry(
  orgId: string,
  profileId: string,
  document: KnowledgeIndexDocument
): Promise<boolean> {
  return (await readEntry(orgId, profileId, document)) !== null;
}

function plainText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

export async function saveKnowledgeIndexEntry(
  orgId: string,
  profileId: string,
  document: KnowledgeIndexDocument,
  rawTopics: unknown,
  partial: boolean
): Promise<void> {
  if (!Array.isArray(rawTopics)) {
    throw new Error("Knowledge index topics must be an array.");
  }
  const topics = rawTopics.slice(0, 5).map((raw): KnowledgeIndexTopic => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Knowledge index topic is invalid.");
    }
    const value = raw as Record<string, unknown>;
    const name = plainText(value?.name, 80);
    const description = plainText(value?.description, 160);
    if (!(name && description)) {
      throw new Error("Knowledge index topic is incomplete.");
    }
    return {
      description,
      name,
      terms: Array.isArray(value.terms)
        ? value.terms
            .slice(0, 5)
            .map((term) => plainText(term, 40))
            .filter(Boolean)
        : [],
    };
  });
  if (topics.length === 0) {
    throw new Error("Knowledge index needs at least one topic.");
  }
  const entry: KnowledgeIndexEntry = {
    contentHash: document.contentHash ?? "",
    documentId: document.id,
    partial,
    topics,
  };
  await writeTextFile(
    entryPath(orgId, document.scope, document.id, profileId),
    `${JSON.stringify(entry)}\n`
  );
}

export async function removeKnowledgeIndexEntry(
  orgId: string,
  profileId: string,
  scope: KnowledgeIndexScope,
  documentId: string
): Promise<void> {
  await rm(entryPath(orgId, scope, documentId, profileId), { force: true });
}

export async function invalidateKnowledgeIndex(
  orgId: string,
  profileId: string
): Promise<void> {
  await Promise.all([
    rm(getKnowledgeIndexPath(orgId, profileId), { force: true }),
    rm(getKnowledgeIndexMetaPath(orgId, profileId), { force: true }),
  ]);
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]<>|]/g, "\\$&");
}

export async function rebuildKnowledgeIndex(
  orgId: string,
  profileId: string
): Promise<KnowledgeIndexStatus> {
  return withKnowledgeIndexLock(orgId, () =>
    rebuildKnowledgeIndexUnlocked(orgId, profileId)
  );
}

async function rebuildKnowledgeIndexUnlocked(
  orgId: string,
  profileId: string
): Promise<KnowledgeIndexStatus> {
  const documents = await listAccessibleKnowledgeDocuments(orgId, profileId);
  const ready = documents.filter((document) => document.status === "ready");
  const entries = await Promise.all(
    ready.map(async (document) => ({
      document,
      entry: await readEntry(orgId, profileId, document),
    }))
  );
  const grouped = new Map<string, string[]>();
  for (const { document, entry } of entries) {
    if (!entry) {
      continue;
    }
    for (const topic of entry.topics) {
      const key = topic.name.toLowerCase();
      const lines = grouped.get(key) ?? [];
      const terms = topic.terms.length
        ? ` Also called: ${topic.terms.map(escapeMarkdown).join(", ")}.`
        : "";
      lines.push(
        `- ${escapeMarkdown(topic.description)}${terms} Source: \`${document.scope}:${document.id}\` (${escapeMarkdown(document.filename.slice(0, 120))}).${entry.partial ? " Partial coverage." : ""}`
      );
      grouped.set(key, lines);
    }
  }
  const lines = ["# Knowledge index"];
  for (const key of [...grouped.keys()].sort()) {
    lines.push("", `## ${escapeMarkdown(key)}`, ...grouped.get(key)!);
  }
  const content = `${lines.join("\n")}\n`;
  const meta: KnowledgeIndexMeta = {
    hash: sha256(content),
    hasPartial: entries.some(({ entry }) => entry?.partial),
    indexedCount: entries.filter(({ entry }) => entry !== null).length,
    readyCount: ready.length,
    revision: indexRevision(documents),
  };
  await writeTextFile(getKnowledgeIndexPath(orgId, profileId), content);
  await writeTextFile(
    getKnowledgeIndexMetaPath(orgId, profileId),
    `${JSON.stringify(meta)}\n`
  );
  return {
    indexedCount: meta.indexedCount,
    readyCount: meta.readyCount,
    status:
      meta.indexedCount === meta.readyCount && !meta.hasPartial
        ? "ready"
        : "partial",
  };
}

async function currentIndex(
  orgId: string,
  profileId: string
): Promise<{ content: string; status: KnowledgeIndexStatus }> {
  return withKnowledgeIndexLock(orgId, () =>
    currentIndexUnlocked(orgId, profileId)
  );
}

async function currentIndexUnlocked(
  orgId: string,
  profileId: string
): Promise<{ content: string; status: KnowledgeIndexStatus }> {
  const documents = await listAccessibleKnowledgeDocuments(orgId, profileId);
  const readyCount = documents.filter(
    (document) => document.status === "ready"
  ).length;
  const [content, rawMeta] = await Promise.all([
    readTextOrNull(getKnowledgeIndexPath(orgId, profileId)),
    readTextOrNull(getKnowledgeIndexMetaPath(orgId, profileId)),
  ]);
  if (!(content && rawMeta)) {
    return {
      content: "",
      status: { indexedCount: 0, readyCount, status: "missing" },
    };
  }
  try {
    const meta = JSON.parse(rawMeta) as KnowledgeIndexMeta;
    if (
      meta.revision !== indexRevision(documents) ||
      meta.hash !== sha256(content)
    ) {
      return {
        content: "",
        status: { indexedCount: 0, readyCount, status: "stale" },
      };
    }
    return {
      content,
      status: {
        indexedCount: meta.indexedCount,
        readyCount,
        status:
          meta.indexedCount === readyCount && !meta.hasPartial
            ? "ready"
            : "partial",
      },
    };
  } catch {
    return {
      content: "",
      status: { indexedCount: 0, readyCount, status: "stale" },
    };
  }
}

export async function getKnowledgeIndexStatus(
  orgId: string,
  profileId: string
): Promise<KnowledgeIndexStatus> {
  return (await currentIndex(orgId, profileId)).status;
}

export async function readKnowledgeIndex(
  orgId: string,
  profileId: string,
  topic?: string,
  offset = 0
): Promise<
  KnowledgeIndexStatus & {
    content: string;
    nextOffset?: number;
    totalLines: number;
  }
> {
  const { content, status } = await currentIndex(orgId, profileId);
  if (!(status.status === "ready" || status.status === "partial")) {
    return { ...status, content: "", totalLines: 0 };
  }
  const lines = content.trimEnd().split("\n");
  let selected: string[];
  if (topic) {
    const start = lines.findIndex(
      (line) =>
        line.toLowerCase() ===
        `## ${escapeMarkdown(topic.trim().toLowerCase())}`
    );
    if (start < 0) {
      return { ...status, content: "", totalLines: 0 };
    }
    const end = lines.findIndex(
      (line, index) => index > start && line.startsWith("## ")
    );
    selected = lines.slice(start, end < 0 ? undefined : end);
  } else {
    selected = lines.filter(
      (line) => line.startsWith("# ") || line.startsWith("## ")
    );
  }
  const begin = Math.min(Math.max(0, offset), selected.length);
  let result = "";
  let index = begin;
  while (index < selected.length) {
    const next = `${result}${selected[index]}\n`;
    if (Buffer.byteLength(next, "utf8") > MAX_INDEX_READ_BYTES) {
      if (!result) {
        result = Buffer.from(next, "utf8")
          .subarray(0, MAX_INDEX_READ_BYTES)
          .toString("utf8");
        index += 1;
      }
      break;
    }
    result = next;
    index += 1;
  }
  return {
    ...status,
    content: result,
    ...(index < selected.length ? { nextOffset: index } : {}),
    totalLines: selected.length,
  };
}
