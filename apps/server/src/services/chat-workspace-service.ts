import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  type ChatWorkspaceFile,
  createId,
  deleteArtifactShareSnapshot,
  getChatSessionDir,
  getChatWorkspaceDir,
  getOrgMemoryDir,
  getProfileSoulDir,
  inferArtifactMimeType,
  NakamaApiError,
} from "@nakama/core";
import type {
  DatabaseAdapter,
  StoredSessionRecord,
  StoredWorkspaceRecord,
} from "@nakama/db";

export interface WorkspaceAccess {
  isPlatformAdmin?: boolean;
  orgRole?: string | null;
  userId?: string | null;
}

// One server owns managed folders. These leases cover turns, delegates, and
// uploads; an exclusive operation never treats a timed-out delegate as stopped.
const writers = new Map<string, number>();
const frozen = new Set<string>();
let allFrozen = false;

export function acquireWorkspaceWrite(id: string): () => void {
  if (allFrozen || frozen.has(id)) {
    throw new NakamaApiError("Workspace is busy. Try again.", 409);
  }
  writers.set(id, (writers.get(id) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const remaining = (writers.get(id) ?? 1) - 1;
    if (remaining) {
      writers.set(id, remaining);
    } else {
      writers.delete(id);
    }
  };
}

export async function withWorkspaceSnapshot<T>(
  id: string | null,
  operation: () => Promise<T>
): Promise<T> {
  if (
    allFrozen ||
    (id
      ? frozen.has(id) || writers.has(id)
      : frozen.size > 0 || writers.size > 0)
  ) {
    throw new NakamaApiError(
      "Wait for running work before changing or exporting storage.",
      409
    );
  }
  if (id) {
    frozen.add(id);
  } else {
    allFrozen = true;
  }
  try {
    return await operation();
  } finally {
    if (id) {
      frozen.delete(id);
    } else {
      allFrozen = false;
    }
  }
}

export function assertWorkspaceAccess(
  workspace: StoredWorkspaceRecord,
  access: WorkspaceAccess,
  allowDeleting = false
): void {
  const admin = access.isPlatformAdmin || access.orgRole === "admin";
  if (
    (!allowDeleting && workspace.state !== "active") ||
    (workspace.access === "admin" && !admin) ||
    (workspace.access === "owner" &&
      !admin &&
      (!workspace.ownerUserId || workspace.ownerUserId !== access.userId))
  ) {
    throw new NakamaApiError("Workspace not found.", 404);
  }
}

/** Resolve persisted relative paths under their owning workspace only. */
export function workspaceFilePath(root: string, path: string): string {
  const target = resolve(root, path);
  const local = relative(root, target);
  if (
    !local ||
    local === ".." ||
    local.startsWith(`..${sep}`) ||
    resolve(path) === path
  ) {
    throw new NakamaApiError("Invalid workspace path.", 400);
  }
  return target;
}

export async function resolveWorkspaceFile(
  root: string,
  path: string
): Promise<string> {
  const target = workspaceFilePath(root, path);
  if ((await lstat(root)).isSymbolicLink()) {
    throw new NakamaApiError("Invalid workspace root.", 400);
  }
  const canonicalRoot = await realpath(root);
  let existing = target;
  while (true) {
    try {
      const canonical = await realpath(existing);
      const local = relative(canonicalRoot, canonical);
      if (
        local === ".." ||
        local.startsWith(`..${sep}`) ||
        resolve(local) === local
      ) {
        throw new NakamaApiError("Invalid workspace path.", 400);
      }
      return target;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" ||
        existing === root
      ) {
        throw error;
      }
      existing = dirname(existing);
    }
  }
}

async function copyVerified(source: string, target: string): Promise<void> {
  const destination = await lstat(target).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  );
  if (destination?.isSymbolicLink()) {
    throw new Error("Migration target must not be a symlink.");
  }
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    return;
  }
  if (info.isDirectory()) {
    await mkdir(target, { mode: 0o700, recursive: true });
    for (const name of await readdir(source)) {
      await copyVerified(join(source, name), join(target, name));
    }
    return;
  }
  if (!info.isFile()) {
    return;
  }
  await mkdir(dirname(target), { mode: 0o700, recursive: true });
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
  const [original, copied] = await Promise.all([
    readFile(source),
    readFile(target),
  ]);
  if (!original.equals(copied)) {
    throw new Error("Workspace migration checksum mismatch.");
  }
}

export class ChatWorkspaceService {
  private readonly preparing = new Map<string, Promise<void>>();
  constructor(private readonly db: DatabaseAdapter) {}

  async initialize(): Promise<void> {
    for (const session of await this.db.listSessions()) {
      if (session.workspaceId) {
        await this.roots(session);
      }
    }
    for (const session of await this.db.listSessions()) {
      if (session.workspaceId === `chat-${session.id}`) {
        await this.recoverSessionReferences(session);
      }
    }
    for (const org of await this.db.listOrganizations()) {
      for (const profile of await this.db.listProfilesForOrg(org.id)) {
        await this.recoverProfile(org.id, profile.id);
      }
    }
  }

  private async recoverSessionReferences(
    record: StoredSessionRecord
  ): Promise<void> {
    const roots = await this.roots(record);
    const workspace = await this.db.getWorkspace(roots.workspaceId);
    if (!workspace) {
      return;
    }
    const messages = await this.db.listMessagesForSession(record.id);
    const ids = new Set<string>();
    const collect = (value: unknown): void => {
      if (typeof value === "string") {
        try {
          collect(JSON.parse(value));
        } catch {
          /* Plain message text. */
        }
      } else if (Array.isArray(value)) {
        for (const item of value) {
          collect(item);
        }
      } else if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
          if (
            (key === "attachmentId" || key === "fileId") &&
            typeof item === "string"
          ) {
            ids.add(item);
          } else {
            collect(item);
          }
        }
      }
    };
    for (const message of messages) {
      collect(message.payload);
    }
    const archive = await readFile(
      join(roots.chatRoot, "history", "archive.jsonl"),
      "utf8"
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return "";
      }
      throw error;
    });
    for (const line of archive.split("\n")) {
      if (line) {
        collect(line);
      }
    }
    const aliases = new Map(
      (await this.db.listSessionFileAliases(record.id)).map((alias) => [
        alias.sourceFileId,
        alias.fileId,
      ])
    );
    for (const sourceId of ids) {
      const file = await this.db.getAttachment(sourceId);
      if (
        !file ||
        file.workspaceId === record.workspaceId ||
        aliases.has(sourceId)
      ) {
        continue;
      }
      const source = file.sessionId
        ? await this.db.getSession(file.sessionId)
        : null;
      // Legacy branches shared file IDs. Recover only verified same-principal references.
      if (
        !source ||
        file.orgId !== workspace.orgId ||
        source.profileId !== record.profileId ||
        source.legacyAppUserId !== record.legacyAppUserId ||
        source.userId !== record.userId ||
        !source.workspaceId
      ) {
        continue;
      }
      const sourceWorkspace = await this.db.getWorkspace(source.workspaceId);
      if (!sourceWorkspace || sourceWorkspace.orgId !== workspace.orgId) {
        continue;
      }
      const sourcePath = await resolveWorkspaceFile(
        getChatWorkspaceDir(sourceWorkspace.orgId, sourceWorkspace.id),
        file.storagePath
      );
      const id = `file_${createHash("sha256").update(`${record.id}\0${sourceId}`).digest("hex")}`;
      const target = join(
        roots.chatRoot,
        file.purpose === "output" ? "outputs" : "inputs",
        `${id}-${(file.filename ?? "file").replace(/[^\w. -]+/g, "_")}`
      );
      await resolveWorkspaceFile(
        roots.workspaceRoot,
        relative(roots.workspaceRoot, target)
      );
      await copyVerified(sourcePath, target);
      if (!(await this.db.getAttachment(id))) {
        await this.db.insertAttachment({
          ...file,
          id,
          sessionId: record.id,
          storagePath: relative(roots.workspaceRoot, target),
          workspaceId: record.workspaceId,
        });
      }
      await this.db.setSessionFileAlias(record.id, sourceId, id);
      aliases.set(sourceId, id);
    }
    if (aliases.size) {
      const remap = (value: unknown): unknown =>
        JSON.parse(
          JSON.stringify(value, (key, item: unknown) => {
            if (
              (key === "attachmentId" || key === "fileId") &&
              typeof item === "string"
            ) {
              return aliases.get(item) ?? item;
            }
            if (key === "content" && typeof item === "string") {
              try {
                const parsed: unknown = JSON.parse(item);
                if (parsed && typeof parsed === "object") {
                  return JSON.stringify(remap(parsed));
                }
              } catch {
                /* Plain tool/message text stays unchanged. */
              }
            }
            return item;
          })
        );
      const updated = messages.map((message) => ({
        ...message,
        payload: remap(message.payload),
      }));
      if (JSON.stringify(updated) !== JSON.stringify(messages)) {
        await this.db.replaceMessagesForSession(record.id, updated);
      }
    }
  }

  async recoverProfile(orgId: string, profileId: string): Promise<void> {
    const legacyRoot = getProfileSoulDir(orgId, profileId);
    const entries = await readdir(legacyRoot, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          return [];
        }
        throw error;
      }
    );
    const identity = new Set([
      "SOUL.md",
      "STYLE.md",
      "INSTRUCTIONS.md",
      "MEMORY.md",
      "memory-archive",
      "memory-history",
      "skills",
      "knowledge-base",
      "avatar.png",
      "avatar.jpg",
      "avatar.webp",
    ]);
    const candidates = entries.filter(
      (entry) => !(identity.has(entry.name) || entry.isSymbolicLink())
    );
    if (candidates.length === 0) {
      return;
    }
    const id = `recovered-${orgId}-${profileId}`;
    const existing = await this.db.getWorkspace(id);
    if (
      existing &&
      (await Bun.file(
        join(getChatWorkspaceDir(orgId, id), "migration-receipt.json")
      ).exists())
    ) {
      return;
    }
    const now = new Date().toISOString();
    const workspace = (await this.db.getWorkspace(id)) ?? {
      access: "admin" as const,
      createdAt: now,
      id,
      kind: "project" as const,
      name: `Recovered files (${profileId})`,
      orgId,
      ownerUserId: null,
      state: "active" as const,
      updatedAt: now,
    };
    if (workspace.orgId !== orgId) {
      throw new Error("Legacy recovery organization mismatch.");
    }
    const root = getChatWorkspaceDir(orgId, id);
    await mkdir(root, { mode: 0o700, recursive: true });
    for (const entry of candidates) {
      await copyVerified(join(legacyRoot, entry.name), join(root, entry.name));
    }
    await this.db.upsertWorkspace(workspace);
    for (const attachment of await this.db.listLegacyAttachmentsForProfile(
      orgId,
      profileId
    )) {
      if (!attachment.storagePath.startsWith(legacyRoot + sep)) {
        continue;
      }
      const local = relative(legacyRoot, attachment.storagePath);
      const path = await resolveWorkspaceFile(root, local);
      if (await stat(path).catch(() => null)) {
        await this.db.updateAttachmentStorage(attachment.id, id, local);
      }
    }
    const files = await this.files(workspace);
    const aliases = files.flatMap((file) => {
      const paths = [file.path, join(legacyRoot, file.path)];
      if (file.path.startsWith("artifacts/")) {
        paths.push(file.path.slice("artifacts/".length));
      }
      return paths.map((path) => ({ fileId: file.id, path }));
    });
    await this.db.adoptLegacyFileBindings(orgId, profileId, id, aliases);
    await writeFile(
      join(root, "migration-receipt.json"),
      JSON.stringify({
        orgId,
        paths: candidates.map((entry) => entry.name),
        profileId,
        recoveredAt: now,
        source: relative(getOrgMemoryDir(orgId), legacyRoot),
      }),
      { mode: 0o600 }
    );
  }

  async create(
    orgId: string,
    kind: "chat" | "project",
    name: string,
    userId: string | null,
    restricted = false
  ): Promise<StoredWorkspaceRecord> {
    const now = new Date().toISOString();
    const workspace: StoredWorkspaceRecord = {
      access: restricted ? "admin" : kind === "project" ? "owner" : "org",
      createdAt: now,
      id: createId(kind === "project" ? "project" : "chat"),
      kind,
      name,
      orgId,
      ownerUserId: userId,
      state: "active",
      updatedAt: now,
    };
    const release = acquireWorkspaceWrite(workspace.id);
    try {
      await mkdir(getChatWorkspaceDir(orgId, workspace.id), {
        mode: 0o700,
        recursive: true,
      });
      await this.db.upsertWorkspace(workspace);
    } finally {
      release();
    }
    return workspace;
  }

  async require(
    orgId: string,
    id: string,
    access: WorkspaceAccess,
    allowDeleting = false
  ): Promise<StoredWorkspaceRecord> {
    const workspace = await this.db.getWorkspace(id);
    if (!workspace || workspace.orgId !== orgId) {
      throw new NakamaApiError("Workspace not found.", 404);
    }
    assertWorkspaceAccess(workspace, access, allowDeleting);
    return workspace;
  }

  async roots(record: StoredSessionRecord): Promise<{
    workspaceRoot: string;
    chatRoot: string;
    outputRoot: string;
    workspaceId: string;
  }> {
    const workspace = record.workspaceId
      ? await this.db.getWorkspace(record.workspaceId)
      : null;
    if (!workspace || workspace.state !== "active") {
      throw new NakamaApiError("Workspace not found.", 404);
    }
    let preparing = this.preparing.get(record.id);
    if (!preparing) {
      preparing = this.prepare(record, workspace);
      this.preparing.set(record.id, preparing);
    }
    try {
      await preparing;
    } finally {
      this.preparing.delete(record.id);
    }
    const chatRoot = getChatSessionDir(
      workspace.orgId,
      workspace.id,
      record.id,
      workspace.kind
    );
    return {
      chatRoot,
      outputRoot: join(chatRoot, "outputs"),
      workspaceId: workspace.id,
      workspaceRoot: getChatWorkspaceDir(workspace.orgId, workspace.id),
    };
  }

  private async prepare(
    record: StoredSessionRecord,
    workspace: StoredWorkspaceRecord
  ): Promise<void> {
    const root = getChatWorkspaceDir(workspace.orgId, workspace.id);
    const chatRoot = getChatSessionDir(
      workspace.orgId,
      workspace.id,
      record.id,
      workspace.kind
    );
    await mkdir(root, { mode: 0o700, recursive: true });
    for (const dir of ["inputs", "outputs", "history"]) {
      await resolveWorkspaceFile(root, relative(root, join(chatRoot, dir)));
    }
    await Promise.all(
      ["inputs", "outputs", "history"].map((dir) =>
        mkdir(join(chatRoot, dir), { mode: 0o700, recursive: true })
      )
    );
    if (workspace.kind === "project") {
      await resolveWorkspaceFile(root, "references");
      await mkdir(join(root, "references"), { mode: 0o700, recursive: true });
    }
    await resolveWorkspaceFile(
      root,
      relative(root, join(chatRoot, "history", "archive.jsonl"))
    );
    const legacyArchive = join(
      getOrgMemoryDir(workspace.orgId),
      "session-history",
      `${encodeURIComponent(record.id)}.jsonl`
    );
    try {
      await copyFile(
        legacyArchive,
        join(chatRoot, "history", "archive.jsonl"),
        constants.COPYFILE_EXCL
      );
    } catch (error) {
      if (
        !["ENOENT", "EEXIST"].includes(
          (error as NodeJS.ErrnoException).code ?? ""
        )
      ) {
        throw error;
      }
    }
    // Copy, verify, then commit the relative locator. Retain legacy bytes until
    // the whole migration is reconciled; retries never overwrite new files.
    for (const attachment of await this.db.listAttachmentsForSession(
      record.id
    )) {
      if (
        !attachment.storagePath.startsWith(
          getProfileSoulDir(workspace.orgId, record.profileId) + sep
        )
      ) {
        continue;
      }
      await resolveWorkspaceFile(
        getProfileSoulDir(workspace.orgId, record.profileId),
        relative(
          getProfileSoulDir(workspace.orgId, record.profileId),
          attachment.storagePath
        )
      );
      const target = join(
        chatRoot,
        "inputs",
        `${attachment.id}-${(attachment.filename ?? "file").replace(/[^\w. -]+/g, "_")}`
      );
      await resolveWorkspaceFile(root, relative(root, target));
      await mkdir(dirname(target), { mode: 0o700, recursive: true });
      try {
        await copyFile(attachment.storagePath, target, constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
      }
      const [sourceBytes, targetBytes] = await Promise.all([
        readFile(attachment.storagePath),
        readFile(target),
      ]);
      if (!sourceBytes.equals(targetBytes)) {
        throw new Error("Attachment migration checksum mismatch.");
      }
      await this.db.updateAttachmentStorage(
        attachment.id,
        workspace.id,
        relative(root, target)
      );
    }
  }

  // ponytail: scan one managed folder; use a directory index if projects exceed 10,000 files.
  async files(
    workspace: StoredWorkspaceRecord,
    sessionId?: string
  ): Promise<ChatWorkspaceFile[]> {
    const root = getChatWorkspaceDir(workspace.orgId, workspace.id);
    if (
      sessionId &&
      (await this.db.getSession(sessionId))?.workspaceId !== workspace.id
    ) {
      throw new NakamaApiError("Session not found.", 404);
    }
    const stored = await this.db.listAttachmentsForWorkspace(workspace.id);
    const paths = new Set(stored.map((file) => file.storagePath));
    const sessions = (await this.db.listSessions()).filter(
      (session) => session.workspaceId === workspace.id
    );
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (
          entry.isSymbolicLink() ||
          entry.name === "history" ||
          entry.name.endsWith(".nakama-meta.json")
        ) {
          continue;
        }
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(absolute);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        const path = relative(root, absolute);
        if (paths.has(path)) {
          continue;
        }
        const ownerSession =
          workspace.kind === "chat"
            ? sessions[0]
            : sessions.find((session) =>
                path.startsWith(`chats/${session.id}/`)
              );
        const purpose = path.startsWith("references/")
          ? "reference"
          : path.includes("/inputs/") || path.startsWith("inputs/")
            ? "input"
            : "output";
        const info = await stat(absolute);
        const id = `file_${createHash("sha256").update(`${workspace.id}\0${path}`).digest("hex")}`;
        if (await this.db.getAttachment(id)) {
          continue;
        }
        try {
          await this.db.insertAttachment({
            channel: ownerSession?.channel ?? "web",
            createdAt: info.birthtime.toISOString(),
            ephemeral: false,
            filename: entry.name,
            id,
            kind: "document",
            mediaType: inferArtifactMimeType(entry.name),
            orgId: workspace.orgId,
            profileId: ownerSession?.profileId ?? "",
            purpose,
            sessionId: ownerSession?.id ?? null,
            sizeBytes: info.size,
            storagePath: path,
            workspaceId: workspace.id,
          });
        } catch (error) {
          const existing = await this.db.getAttachment(id);
          if (
            existing?.workspaceId !== workspace.id ||
            existing.storagePath !== path
          ) {
            throw error;
          }
        }
      }
    };
    await mkdir(root, { mode: 0o700, recursive: true });
    if ((await lstat(root)).isSymbolicLink()) {
      throw new NakamaApiError("Invalid workspace root.", 400);
    }
    await walk(root);
    const files: ChatWorkspaceFile[] = [];
    for (const file of await this.db.listAttachmentsForWorkspace(
      workspace.id
    )) {
      if (sessionId && file.sessionId && file.sessionId !== sessionId) {
        continue;
      }
      const path = await resolveWorkspaceFile(root, file.storagePath);
      const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          return null;
        }
        throw error;
      });
      if (!info?.isFile()) {
        continue;
      }
      if (info.size !== file.sizeBytes) {
        await this.db.updateAttachmentStorage(
          file.id,
          workspace.id,
          file.storagePath,
          info.size
        );
      }
      files.push({
        filename: file.filename ?? file.id,
        id: file.id,
        mediaType: file.mediaType,
        path: file.storagePath,
        purpose: file.purpose ?? "input",
        sessionId: file.sessionId,
        sizeBytes: info.size,
        workspaceId: workspace.id,
      });
    }
    return files;
  }

  async fork(
    source: StoredSessionRecord,
    target: StoredSessionRecord
  ): Promise<Map<string, string>> {
    const sourceWorkspace = source.workspaceId
      ? await this.db.getWorkspace(source.workspaceId)
      : null;
    if (sourceWorkspace) {
      await this.files(sourceWorkspace);
    }
    const sourceRoots = await this.roots(source);
    const targetRoots = await this.roots(target);
    await copyVerified(sourceRoots.chatRoot, targetRoots.chatRoot);
    const mapping = new Map<string, string>();
    for (const file of await this.db.listAttachmentsForSession(source.id)) {
      const absolute = workspaceFilePath(
        sourceRoots.workspaceRoot,
        file.storagePath
      );
      const local = relative(sourceRoots.chatRoot, absolute);
      if (local.startsWith("..") || resolve(local) === local) {
        continue;
      }
      const id = createId("file");
      await this.db.insertAttachment({
        ...file,
        id,
        sessionId: target.id,
        storagePath: relative(
          targetRoots.workspaceRoot,
          join(targetRoots.chatRoot, local)
        ),
        workspaceId: target.workspaceId,
      });
      mapping.set(file.id, id);
      await this.db.setSessionFileAlias(target.id, file.id, id);
    }
    for (const alias of await this.db.listSessionFileAliases(source.id)) {
      const id = mapping.get(alias.fileId);
      if (id) {
        await this.db.setSessionFileAlias(target.id, alias.sourceFileId, id);
      }
    }
    return mapping;
  }

  async registerFile(
    workspaceId: string,
    orgId: string,
    sessionId: string,
    absolutePath: string
  ): Promise<{ fileId: string; workspaceId: string; path: string }> {
    const workspace = await this.db.getWorkspace(workspaceId);
    const session = await this.db.getSession(sessionId);
    if (
      workspace?.orgId !== orgId ||
      workspace.state !== "active" ||
      session?.workspaceId !== workspaceId ||
      session.deleting
    ) {
      throw new NakamaApiError("Workspace unavailable.", 409);
    }
    const root = getChatWorkspaceDir(orgId, workspaceId);
    const path = relative(await realpath(root), await realpath(absolutePath));
    await resolveWorkspaceFile(root, path);
    await this.files(workspace, sessionId);
    const file = (await this.db.listAttachmentsForWorkspace(workspaceId)).find(
      (entry) => entry.storagePath === path
    );
    if (!file) {
      throw new NakamaApiError("File not found.", 404);
    }
    return { fileId: file.id, path, workspaceId };
  }

  async removeEmpty(workspace: StoredWorkspaceRecord): Promise<void> {
    await this.db.upsertWorkspace({
      ...workspace,
      state: "deleting",
      updatedAt: new Date().toISOString(),
    });
    for (const share of await this.db.listArtifactSharesForWorkspace(
      workspace.id
    )) {
      await deleteArtifactShareSnapshot(workspace.orgId, share.storagePath);
    }
    await rm(getChatWorkspaceDir(workspace.orgId, workspace.id), {
      force: true,
      recursive: true,
    });
    await this.db.deleteWorkspace(workspace.id);
  }

  async removeFileShares(workspaceId: string, fileId: string): Promise<void> {
    for (const share of await this.db.listArtifactSharesForWorkspace(
      workspaceId
    )) {
      if (share.fileId === fileId) {
        await deleteArtifactShareSnapshot(share.orgId, share.storagePath);
      }
    }
  }
}
