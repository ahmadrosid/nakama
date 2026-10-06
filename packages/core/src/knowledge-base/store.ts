import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  DocumentAttachment,
  KnowledgeBaseDocument,
  KnowledgeBaseDuplicateAction,
  KnowledgeBaseUploadOutcome,
} from "../contract";
import {
  ensureDir,
  pathExists,
  readBytes,
  readTextOrNull,
  removeFile,
  writePrivateBytesFile,
  writeTextFile,
} from "../fs";
import { createId } from "../ids";
import { MAX_KNOWLEDGE_DOCUMENT_BYTES } from "../message-content";
import { getProfileSoulDir } from "../soul/resolve";
import { getOrgConfigDir } from "../user-config";
import {
  buildExtractedTextHeader,
  extractText,
  isSupportedKnowledgeBaseMediaType,
  normalizeKnowledgeBaseMediaType,
} from "./extract";
import {
  getKnowledgeBaseDir,
  getKnowledgeBaseExtractedPath,
  getKnowledgeBaseManifestPath,
  getKnowledgeBaseStoredDocumentPath,
  getKnowledgeIndexEntryPath,
  getKnowledgeIndexMetaPath,
  getKnowledgeIndexPath,
  getOrgKnowledgeBaseDir,
} from "./paths";

export interface KnowledgeIndexJob {
  contentHash: string;
  documentId: string;
  profileId?: string;
  scope: "profile" | "organization";
  state: "pending" | "claimed" | "waiting" | "failed" | "done";
}

function indexWorkPath(orgId: string): string {
  return join(getOrgKnowledgeBaseDir(orgId), "index-work.json");
}

async function readIndexWork(orgId: string): Promise<KnowledgeIndexJob[]> {
  const raw = await readTextOrNull(indexWorkPath(orgId));
  if (!raw) {
    return [];
  }
  try {
    const jobs = JSON.parse(raw);
    return Array.isArray(jobs) ? jobs : [];
  } catch {
    return [];
  }
}

async function writeIndexWork(
  orgId: string,
  jobs: KnowledgeIndexJob[]
): Promise<void> {
  await writeTextFile(indexWorkPath(orgId), `${JSON.stringify(jobs)}\n`);
}

async function indexingEnabled(orgId: string): Promise<boolean> {
  const raw = await readTextOrNull(
    join(getOrgKnowledgeBaseDir(orgId), "index-settings.json")
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

async function enqueueIndexJob(
  orgId: string,
  document: KnowledgeBaseDocument,
  scope: KnowledgeIndexJob["scope"],
  profileId?: string
): Promise<void> {
  if (document.status !== "ready" || !(await indexingEnabled(orgId))) {
    return;
  }
  const dir =
    scope === "organization"
      ? getOrgKnowledgeBaseDir(orgId)
      : getKnowledgeBaseDir(orgId, profileId!);
  const saved = await readTextOrNull(
    getKnowledgeIndexEntryPath(dir, document.id)
  );
  if (saved) {
    try {
      if (JSON.parse(saved).contentHash === document.contentHash) {
        return;
      }
    } catch {
      // Rebuild this entry below.
    }
  }
  const jobs = await readIndexWork(orgId);
  if (
    jobs.some(
      (job) =>
        job.documentId === document.id &&
        job.contentHash === document.contentHash
    )
  ) {
    return;
  }
  const pendingCount = jobs.filter(
    (job) =>
      job.state === "pending" || job.state === "claimed" || job.state === "done"
  ).length;
  jobs.push({
    contentHash: document.contentHash ?? "",
    documentId: document.id,
    ...(profileId ? { profileId } : {}),
    scope,
    state: pendingCount < 6 ? "pending" : "waiting",
  });
  await writeIndexWork(orgId, jobs);
}

export async function listKnowledgeIndexJobs(
  orgId: string
): Promise<KnowledgeIndexJob[]> {
  return readIndexWork(orgId);
}

export async function claimKnowledgeIndexJob(
  orgId: string
): Promise<KnowledgeIndexJob | null> {
  return withKnowledgeIndexLock(orgId, async () => {
    if (!(await indexingEnabled(orgId))) {
      return null;
    }
    const jobs = await readIndexWork(orgId);
    const job = jobs.find((item) => item.state === "pending");
    if (!job) {
      return null;
    }
    job.state = "claimed";
    await writeIndexWork(orgId, jobs);
    return job;
  });
}

export async function finishKnowledgeIndexJob(
  orgId: string,
  documentId: string,
  failed: boolean
): Promise<void> {
  await withKnowledgeIndexLock(orgId, async () => {
    const jobs = await readIndexWork(orgId);
    const job = jobs.find(
      (item) => item.documentId === documentId && item.state === "claimed"
    );
    if (!job) {
      return;
    }
    job.state = failed ? "failed" : "done";
    await writeIndexWork(orgId, jobs);
  });
}

async function forgetIndexJob(
  orgId: string,
  documentId: string
): Promise<void> {
  const jobs = await readIndexWork(orgId);
  if (!jobs.some((job) => job.documentId === documentId)) {
    return;
  }
  await writeIndexWork(
    orgId,
    jobs.filter((job) => job.documentId !== documentId)
  );
}

export async function approveKnowledgeIndexJobs(
  orgId: string
): Promise<number> {
  return withKnowledgeIndexLock(orgId, async () => {
    const current = await readIndexWork(orgId);
    if (current.some((job) => job.state === "pending")) {
      throw new Error("Approved index work remains pending.");
    }
    const workerAge = await stat(
      join(getOrgKnowledgeBaseDir(orgId), ".index-worker.lock")
    )
      .then((value) => Date.now() - value.mtimeMs)
      .catch(() => Number.POSITIVE_INFINITY);
    if (workerAge < 120_000) {
      throw new Error("Knowledge index is updating.");
    }
    const jobs = current.filter((job) => job.state !== "done");
    let count = 0;
    for (const job of jobs) {
      if (count === 6) {
        break;
      }
      if (
        job.state === "waiting" ||
        job.state === "failed" ||
        job.state === "claimed"
      ) {
        job.state = "pending";
        count += 1;
      }
    }
    await writeIndexWork(orgId, jobs);
    return count;
  });
}

export async function queueKnowledgeIndexBackfill(
  orgId: string,
  force = false
): Promise<number> {
  return withKnowledgeIndexLock(orgId, async () => {
    if (force) {
      const workerAge = await stat(
        join(getOrgKnowledgeBaseDir(orgId), ".index-worker.lock")
      )
        .then((value) => Date.now() - value.mtimeMs)
        .catch(() => Number.POSITIVE_INFINITY);
      if (workerAge < 120_000) {
        throw new Error("Knowledge index is updating.");
      }
      await writeIndexWork(orgId, []);
      for (const profileId of await listProfileIdsOnDisk(orgId)) {
        await removeProfileIndex(orgId, profileId);
        for (const document of await listKnowledgeBaseDocuments(
          orgId,
          profileId
        )) {
          await rm(
            getKnowledgeIndexEntryPath(
              getKnowledgeBaseDir(orgId, profileId),
              document.id
            ),
            { force: true }
          );
        }
      }
      for (const document of await listOrganizationKnowledgeBaseDocuments(
        orgId
      )) {
        await rm(
          getKnowledgeIndexEntryPath(
            getOrgKnowledgeBaseDir(orgId),
            document.id
          ),
          { force: true }
        );
      }
    }
    let queued = 0;
    for (const profileId of await listProfileIdsOnDisk(orgId)) {
      for (const document of await listKnowledgeBaseDocuments(
        orgId,
        profileId
      )) {
        if (document.status === "ready") {
          await enqueueIndexJob(orgId, document, "profile", profileId);
          queued += 1;
        }
      }
    }
    for (const document of await listOrganizationKnowledgeBaseDocuments(
      orgId
    )) {
      if (document.status === "ready") {
        await enqueueIndexJob(orgId, document, "organization");
        queued += 1;
      }
    }
    return queued;
  });
}

async function removeProfileIndex(
  orgId: string,
  profileId: string
): Promise<void> {
  await Promise.all([
    rm(getKnowledgeIndexPath(orgId, profileId), { force: true }),
    rm(getKnowledgeIndexMetaPath(orgId, profileId), { force: true }),
  ]);
}

export async function withKnowledgeIndexLock<T>(
  orgId: string,
  action: () => Promise<T>
): Promise<T> {
  const dir = getOrgKnowledgeBaseDir(orgId);
  const lock = join(dir, ".index.lock");
  await ensureDir(dir);
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      await mkdir(lock);
      try {
        return await action();
      } finally {
        await rm(lock, { force: true, recursive: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const age = await stat(lock)
        .then((value) => Date.now() - value.mtimeMs)
        .catch(() => 0);
      if (age > 120_000) {
        await rm(lock, { force: true, recursive: true });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("Knowledge index is busy.");
}

export async function acquireKnowledgeIndexWorkerLease(
  orgId: string
): Promise<(() => Promise<void>) | null> {
  const dir = getOrgKnowledgeBaseDir(orgId);
  const lock = join(dir, ".index-worker.lock");
  await ensureDir(dir);
  try {
    await mkdir(lock);
    return () => rm(lock, { force: true, recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    const age = await stat(lock)
      .then((value) => Date.now() - value.mtimeMs)
      .catch(() => 0);
    if (age > 120_000) {
      await rm(lock, { force: true, recursive: true });
    }
    return null;
  }
}

interface KnowledgeBaseManifest {
  documents: KnowledgeBaseDocument[];
  /** Additive references to organization-owned documents. */
  sharedDocumentIds?: string[];
}

export type KnowledgeBaseDuplicateMatch = "content_hash" | "name_size";

export class KnowledgeBaseDuplicateError extends Error {
  readonly existing: KnowledgeBaseDocument;
  readonly match: KnowledgeBaseDuplicateMatch;

  constructor(
    existing: KnowledgeBaseDocument,
    match: KnowledgeBaseDuplicateMatch
  ) {
    super(
      `Duplicate knowledge base document: ${existing.filename} (matched by ${match === "content_hash" ? "content hash" : "name and size"}).`
    );
    this.name = "KnowledgeBaseDuplicateError";
    this.existing = existing;
    this.match = match;
  }
}

export class KnowledgeBaseDocumentInUseError extends Error {
  constructor(
    readonly documentId: string,
    readonly profileIds: string[]
  ) {
    super(
      `Shared knowledge base document is still used by ${profileIds.length} profile(s).`
    );
    this.name = "KnowledgeBaseDocumentInUseError";
  }
}

export interface UploadKnowledgeBaseDocumentResult {
  document: KnowledgeBaseDocument;
  outcome: KnowledgeBaseUploadOutcome;
}

function findDuplicateDocument(
  documents: KnowledgeBaseDocument[],
  candidate: { contentHash: string; filename: string; sizeBytes: number }
): {
  document: KnowledgeBaseDocument;
  match: KnowledgeBaseDuplicateMatch;
} | null {
  const byHash = documents.find(
    (document) => document.contentHash === candidate.contentHash
  );
  if (byHash) {
    return { document: byHash, match: "content_hash" };
  }

  const byNameSize = documents.find(
    (document) =>
      document.filename === candidate.filename &&
      document.sizeBytes === candidate.sizeBytes
  );
  if (byNameSize) {
    return { document: byNameSize, match: "name_size" };
  }

  return null;
}

function legacyKnowledgeBaseDir(orgId: string, profileId: string): string {
  return join(getProfileSoulDir(orgId, profileId), "data", "knowledge-base");
}

async function migrateLegacyKnowledgeBaseDir(
  orgId: string,
  profileId: string
): Promise<void> {
  const legacyDir = legacyKnowledgeBaseDir(orgId, profileId);
  const currentDir = getKnowledgeBaseDir(orgId, profileId);

  if (!(await pathExists(legacyDir)) || (await pathExists(currentDir))) {
    return;
  }

  await rename(legacyDir, currentDir);
}

async function moveIfPresent(from: string, to: string): Promise<void> {
  if (!(await pathExists(from)) || (await pathExists(to))) {
    return;
  }

  await rename(from, to);
}

async function flattenKnowledgeBaseLayout(dir: string): Promise<void> {
  const uploadsDir = join(dir, "uploads");
  const extractedDir = join(dir, "extracted");

  if (await pathExists(extractedDir)) {
    const entries = await readdir(extractedDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const legacyPath = join(extractedDir, entry.name);
      const documentId = entry.name.replace(/\.txt$/i, "");
      await moveIfPresent(
        legacyPath,
        getKnowledgeBaseExtractedPath(dir, documentId)
      );
    }
    await rm(extractedDir, { force: true, recursive: true });
  }

  if (await pathExists(uploadsDir)) {
    const documentDirs = await readdir(uploadsDir, { withFileTypes: true });
    for (const documentDir of documentDirs) {
      if (!documentDir.isDirectory()) {
        continue;
      }

      const legacyDocumentDir = join(uploadsDir, documentDir.name);
      const files = await readdir(legacyDocumentDir, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile()) {
          continue;
        }

        await moveIfPresent(
          join(legacyDocumentDir, file.name),
          getKnowledgeBaseStoredDocumentPath(dir, documentDir.name, file.name)
        );
      }
    }
    await rm(uploadsDir, { force: true, recursive: true });
  }
}

/**
 * Resolve a profile's knowledge base root, migrating the pre-`knowledge-base`
 * layout first. Every profile-scoped entry point goes through here so a legacy
 * profile is never read from the wrong directory.
 */
async function profileKnowledgeBaseDir(
  orgId: string,
  profileId: string
): Promise<string> {
  await migrateLegacyKnowledgeBaseDir(orgId, profileId);
  const dir = getKnowledgeBaseDir(orgId, profileId);
  await flattenKnowledgeBaseLayout(dir);
  return dir;
}

/** Resolve the organization knowledge base root used for shared documents. */
async function orgKnowledgeBaseDir(orgId: string): Promise<string> {
  const dir = getOrgKnowledgeBaseDir(orgId);
  await flattenKnowledgeBaseLayout(dir);
  return dir;
}

function decodeDocumentBytes(data: string): Buffer {
  const raw = data.trim();
  const base64 = raw.includes(",") ? (raw.split(",")[1] ?? "") : raw;
  return Buffer.from(base64, "base64");
}

function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop()?.trim() ?? "document";

  return base.replace(/[^\w.\-() ]+/g, "_") || "document";
}

async function readManifestFrom(dir: string): Promise<KnowledgeBaseManifest> {
  const manifestPath = getKnowledgeBaseManifestPath(dir);
  const raw = await readTextOrNull(manifestPath);

  if (!raw) {
    return { documents: [] };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as KnowledgeBaseManifest).documents)
    ) {
      // A manifest written by an older build or edited by hand can carry
      // `sharedDocumentIds` in any shape: normalized on read, a string would
      // substring-match document ids and break `filter` on detach.
      const rawShared = (parsed as KnowledgeBaseManifest).sharedDocumentIds;
      const sharedDocumentIds = Array.isArray(rawShared)
        ? rawShared.filter(
            (entry): entry is string =>
              typeof entry === "string" && entry.length > 0
          )
        : undefined;

      return {
        documents: (parsed as KnowledgeBaseManifest).documents,
        sharedDocumentIds:
          sharedDocumentIds && sharedDocumentIds.length > 0
            ? sharedDocumentIds
            : undefined,
      };
    }
  } catch {
    // fall through to empty manifest
  }

  return { documents: [] };
}

/**
 * Read the references a profile holds without touching its layout. Asking
 * whether a shared document is still in use must not write: the directory
 * helpers rename the legacy layout and `rm -rf` its `extracted/` and `uploads/`
 * folders, so a failed rename mid-loop would abort the delete on a half
 * migrated tree.
 */
async function readProfileManifestForReference(
  orgId: string,
  profileId: string
): Promise<KnowledgeBaseManifest> {
  const dir = getKnowledgeBaseDir(orgId, profileId);

  if (await pathExists(getKnowledgeBaseManifestPath(dir))) {
    return await readManifestFrom(dir);
  }

  return await readManifestFrom(legacyKnowledgeBaseDir(orgId, profileId));
}

async function writeManifestTo(
  dir: string,
  manifest: KnowledgeBaseManifest
): Promise<void> {
  const manifestPath = getKnowledgeBaseManifestPath(dir);
  const tempPath = `${manifestPath}.tmp`;
  const content = `${JSON.stringify(manifest, null, 2)}\n`;

  await writeTextFile(tempPath, content);
  await rename(tempPath, manifestPath);
}

function sortByUploadedAt(
  documents: KnowledgeBaseDocument[]
): KnowledgeBaseDocument[] {
  return [...documents].sort((left, right) =>
    right.uploadedAt.localeCompare(left.uploadedAt)
  );
}

export async function ensureKnowledgeBaseDirs(
  orgId: string,
  profileId: string
): Promise<void> {
  const dir = await profileKnowledgeBaseDir(orgId, profileId);
  await ensureDir(dir);
}

export async function listKnowledgeBaseDocuments(
  orgId: string,
  profileId: string
): Promise<KnowledgeBaseDocument[]> {
  const dir = await profileKnowledgeBaseDir(orgId, profileId);
  const manifest = await readManifestFrom(dir);
  return sortByUploadedAt(manifest.documents);
}

export async function listOrganizationKnowledgeBaseDocuments(
  orgId: string
): Promise<KnowledgeBaseDocument[]> {
  const manifest = await readManifestFrom(await orgKnowledgeBaseDir(orgId));
  return sortByUploadedAt(manifest.documents);
}

/**
 * Refuse to drop an organization document while any profile still references
 * it, so an attachment can never point at a missing file.
 */
async function guardSharedDocumentRemoval(
  orgId: string,
  documentId: string,
  knownProfileIds?: readonly string[]
): Promise<void> {
  const profileIds = await findProfilesReferencingSharedDocument(
    orgId,
    documentId,
    knownProfileIds
  );
  if (profileIds.length > 0) {
    throw new KnowledgeBaseDocumentInUseError(documentId, profileIds);
  }
}

async function uploadDocumentTo(
  dir: string,
  attachment: DocumentAttachment,
  onDuplicate: KnowledgeBaseDuplicateAction,
  guardRemoval?: (documentId: string) => Promise<void>,
  beforeChange?: () => Promise<void>
): Promise<UploadKnowledgeBaseDocumentResult> {
  const filename = attachment.filename.trim();

  if (!filename) {
    throw new Error("Document filename must not be empty.");
  }

  const mediaType = normalizeKnowledgeBaseMediaType(
    attachment.mediaType,
    filename
  );

  if (!isSupportedKnowledgeBaseMediaType(mediaType, filename)) {
    throw new Error(
      `Unsupported knowledge base document type: ${attachment.mediaType}. Allowed: txt, md, csv, pdf.`
    );
  }

  const bytes = decodeDocumentBytes(attachment.data);

  if (bytes.length === 0) {
    throw new Error("Document data must not be empty.");
  }

  if (bytes.length > MAX_KNOWLEDGE_DOCUMENT_BYTES) {
    throw new Error(
      `Document must be at most ${MAX_KNOWLEDGE_DOCUMENT_BYTES / (1024 * 1024)} MB.`
    );
  }

  await ensureDir(dir);

  const contentHash = createHash("sha256").update(bytes).digest("hex");
  let outcome: KnowledgeBaseUploadOutcome = "created";

  const existingManifest = await readManifestFrom(dir);
  const duplicate = findDuplicateDocument(existingManifest.documents, {
    contentHash,
    filename,
    sizeBytes: bytes.length,
  });

  if (duplicate) {
    if (onDuplicate === "skip") {
      return { document: duplicate.document, outcome: "skipped" };
    }

    if (onDuplicate === "error") {
      throw new KnowledgeBaseDuplicateError(
        duplicate.document,
        duplicate.match
      );
    }

    const removed = await deleteDocumentFrom(
      dir,
      duplicate.document.id,
      guardRemoval,
      beforeChange
    );
    if (!removed) {
      throw new Error("Failed to replace existing knowledge base document.");
    }
    outcome = "replaced";
  }

  const documentId = createId("kb");
  const uploadedAt = new Date().toISOString();
  const safeFilename = sanitizeFilename(filename);
  const originalPath = getKnowledgeBaseStoredDocumentPath(
    dir,
    documentId,
    safeFilename
  );

  await writePrivateBytesFile(originalPath, bytes);

  let status: KnowledgeBaseDocument["status"] = "ready";
  let error: string | undefined;

  try {
    const body = await extractText(mediaType, filename, bytes);

    if (!body) {
      throw new Error("No text could be extracted from the document.");
    }

    const header = buildExtractedTextHeader({
      filename,
      mediaType,
      uploadedAt,
    });
    await writeTextFile(
      getKnowledgeBaseExtractedPath(dir, documentId),
      `${header}${body}\n`
    );
  } catch (extractError) {
    status = "failed";
    error =
      extractError instanceof Error
        ? extractError.message
        : String(extractError);
  }

  const document: KnowledgeBaseDocument = {
    contentHash,
    filename,
    id: documentId,
    mediaType,
    sizeBytes: bytes.length,
    status,
    uploadedAt,
    ...(error ? { error } : {}),
  };

  const manifest = await readManifestFrom(dir);
  manifest.documents.push(document);
  await beforeChange?.();
  await writeManifestTo(dir, manifest);

  return { document, outcome };
}

export async function uploadKnowledgeBaseDocument(
  orgId: string,
  profileId: string,
  attachment: DocumentAttachment,
  onDuplicate: KnowledgeBaseDuplicateAction = "error"
): Promise<UploadKnowledgeBaseDocumentResult> {
  return withKnowledgeIndexLock(orgId, async () => {
    const result = await uploadDocumentTo(
      await profileKnowledgeBaseDir(orgId, profileId),
      attachment,
      onDuplicate,
      undefined,
      () => removeProfileIndex(orgId, profileId)
    );
    if (result.outcome !== "skipped") {
      await enqueueIndexJob(orgId, result.document, "profile", profileId);
    }
    return result;
  });
}

export async function uploadOrganizationKnowledgeBaseDocument(
  orgId: string,
  attachment: DocumentAttachment,
  onDuplicate: KnowledgeBaseDuplicateAction = "error",
  knownProfileIds?: readonly string[]
): Promise<UploadKnowledgeBaseDocumentResult> {
  return withKnowledgeIndexLock(orgId, async () => {
    const result = await uploadDocumentTo(
      await orgKnowledgeBaseDir(orgId),
      attachment,
      onDuplicate,
      (documentId) =>
        guardSharedDocumentRemoval(orgId, documentId, knownProfileIds)
    );
    if (result.outcome !== "skipped") {
      await enqueueIndexJob(orgId, result.document, "organization");
    }
    return result;
  });
}

/**
 * Profiles that still reference a shared document. `knownProfileIds` comes from
 * the profile table so a leftover directory whose profile row is gone can never
 * block the delete: the endpoint used to answer `409` with a `profileIds` entry
 * that `listProfiles` does not return, leaving no way to detach it.
 */
export async function findProfilesReferencingSharedDocument(
  orgId: string,
  documentId: string,
  knownProfileIds?: readonly string[]
): Promise<string[]> {
  const candidates = knownProfileIds
    ? [...knownProfileIds]
    : await listProfileIdsOnDisk(orgId);
  const profileIds: string[] = [];
  for (const profileId of candidates) {
    const manifest = await readProfileManifestForReference(orgId, profileId);
    if (manifest.sharedDocumentIds?.includes(documentId)) {
      profileIds.push(profileId);
    }
  }
  return profileIds.sort();
}

async function listProfileIdsOnDisk(orgId: string): Promise<string[]> {
  const profilesDir = join(getOrgConfigDir(orgId), "profiles");
  if (!(await pathExists(profilesDir))) {
    return [];
  }
  const entries = await readdir(profilesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

async function deleteDocumentFrom(
  dir: string,
  documentId: string,
  guardRemoval?: (documentId: string) => Promise<void>,
  beforeChange?: () => Promise<void>
): Promise<boolean> {
  const manifest = await readManifestFrom(dir);
  const index = manifest.documents.findIndex(
    (document) => document.id === documentId
  );

  if (index < 0) {
    return false;
  }

  if (guardRemoval) {
    await guardRemoval(documentId);
  }

  await beforeChange?.();

  const document = manifest.documents[index]!;
  manifest.documents.splice(index, 1);
  await writeManifestTo(dir, manifest);
  await rm(getKnowledgeIndexEntryPath(dir, documentId), { force: true });

  const storedPath = getKnowledgeBaseStoredDocumentPath(
    dir,
    documentId,
    document.filename
  );
  const extractedPath = getKnowledgeBaseExtractedPath(dir, documentId);

  if (await pathExists(storedPath)) {
    await removeFile(storedPath);
  }

  if (await pathExists(extractedPath)) {
    await removeFile(extractedPath);
  }

  return true;
}

export async function deleteKnowledgeBaseDocument(
  orgId: string,
  profileId: string,
  documentId: string
): Promise<boolean> {
  const dir = await profileKnowledgeBaseDir(orgId, profileId);
  return withKnowledgeIndexLock(orgId, async () => {
    const deleted = await deleteDocumentFrom(dir, documentId, undefined, () =>
      removeProfileIndex(orgId, profileId)
    );
    if (deleted) {
      await forgetIndexJob(orgId, documentId);
    }
    return deleted;
  });
}

export async function deleteOrganizationKnowledgeBaseDocument(
  orgId: string,
  documentId: string,
  knownProfileIds?: readonly string[]
): Promise<boolean> {
  const dir = await orgKnowledgeBaseDir(orgId);
  return withKnowledgeIndexLock(orgId, async () => {
    const deleted = await deleteDocumentFrom(dir, documentId, (candidate) =>
      guardSharedDocumentRemoval(orgId, candidate, knownProfileIds)
    );
    if (deleted) {
      await forgetIndexJob(orgId, documentId);
    }
    return deleted;
  });
}

export async function getProfileSharedDocumentIds(
  orgId: string,
  profileId: string
): Promise<string[]> {
  const dir = await profileKnowledgeBaseDir(orgId, profileId);
  const manifest = await readManifestFrom(dir);
  return [...new Set(manifest.sharedDocumentIds ?? [])];
}

export async function attachSharedKnowledgeBaseDocument(
  orgId: string,
  profileId: string,
  documentId: string
): Promise<void> {
  return withKnowledgeIndexLock(orgId, async () => {
    const shared = await readManifestFrom(await orgKnowledgeBaseDir(orgId));
    if (!shared.documents.some((document) => document.id === documentId)) {
      throw new Error("Shared knowledge base document not found.");
    }
    const dir = await profileKnowledgeBaseDir(orgId, profileId);
    const manifest = await readManifestFrom(dir);
    await removeProfileIndex(orgId, profileId);
    manifest.sharedDocumentIds = [
      ...new Set([...(manifest.sharedDocumentIds ?? []), documentId]),
    ];
    await writeManifestTo(dir, manifest);
  });
}

export async function detachSharedKnowledgeBaseDocument(
  orgId: string,
  profileId: string,
  documentId: string
): Promise<boolean> {
  return withKnowledgeIndexLock(orgId, async () => {
    const dir = await profileKnowledgeBaseDir(orgId, profileId);
    const manifest = await readManifestFrom(dir);
    const ids = manifest.sharedDocumentIds ?? [];
    if (!ids.includes(documentId)) {
      return false;
    }
    await removeProfileIndex(orgId, profileId);
    manifest.sharedDocumentIds = ids.filter((id) => id !== documentId);
    await writeManifestTo(dir, manifest);
    return true;
  });
}

/**
 * Strip the metadata header that `uploadKnowledgeBaseDocument` prepends to the
 * extracted text file, so previews show the document body without the redundant
 * `# source:` / `# mediaType:` / `# uploadedAt:` preamble. Matches the exact
 * header prefixes so a markdown body that starts with `#` is never mistaken
 * for metadata.
 */
function stripExtractedTextHeader(text: string): string {
  const match = text.match(
    /^# source: [^\n]*\n# mediaType: [^\n]*\n# uploadedAt: [^\n]*\n/
  );
  if (match) {
    return text.slice(match[0].length);
  }

  return text;
}

async function readDocumentContentFrom(
  dir: string,
  documentId: string,
  options: { render?: "text" }
): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
  const manifest = await readManifestFrom(dir);
  const document = manifest.documents.find((entry) => entry.id === documentId);

  if (!document) {
    throw new Error("Knowledge base document not found.");
  }

  const storedPath = getKnowledgeBaseStoredDocumentPath(
    dir,
    documentId,
    document.filename
  );

  const isTextLike =
    document.mediaType === "text/plain" ||
    document.mediaType === "text/csv" ||
    document.mediaType === "text/markdown";

  if (options.render === "text") {
    if (isTextLike && (await pathExists(storedPath))) {
      return {
        bytes: await readBytes(storedPath),
        contentType: document.mediaType,
        filename: document.filename,
      };
    }

    const extractedPath = getKnowledgeBaseExtractedPath(dir, documentId);

    if (await pathExists(extractedPath)) {
      const raw = (await readBytes(extractedPath)).toString("utf8");
      const body = stripExtractedTextHeader(raw);
      return {
        bytes: Buffer.from(body, "utf8"),
        contentType: "text/plain",
        filename: document.filename,
      };
    }

    throw new Error("Preview is not available for this document.");
  }

  if (!(await pathExists(storedPath))) {
    throw new Error("Knowledge base document file not found.");
  }

  return {
    bytes: await readBytes(storedPath),
    contentType: document.mediaType,
    filename: document.filename,
  };
}

export async function readKnowledgeBaseDocumentContent(
  orgId: string,
  profileId: string,
  documentId: string,
  options: { render?: "text" } = {}
): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
  const dir = await profileKnowledgeBaseDir(orgId, profileId);
  return readDocumentContentFrom(dir, documentId, options);
}

export async function readOrganizationKnowledgeBaseDocumentContent(
  orgId: string,
  documentId: string,
  options: { render?: "text" } = {}
): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
  const dir = await orgKnowledgeBaseDir(orgId);
  return readDocumentContentFrom(dir, documentId, options);
}
