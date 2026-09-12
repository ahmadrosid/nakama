import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { PluginExecutionContext } from "@nakama/core";
import {
  type Connection,
  normalizeUrl,
  SupermemoryClient,
  SupermemoryError,
} from "./client";

type Context = PluginExecutionContext & {
  host(request: Record<string, unknown>): Promise<unknown>;
};
type Input = Record<string, unknown>;
type Kind = "memory" | "knowledge";
type Receipt = {
  id: string;
  profile_id: string;
  kind: Kind;
  operation_key: string;
  payload_hash: string;
  upstream_id: string | null;
  custom_id: string;
  title: string;
  source: string;
  state: string;
  created_at: number;
  updated_at: number;
};
const hash = (parts: string[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");
function required(value: unknown, name: string, max = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`Invalid ${name}`);
  }
  return value.trim();
}
function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid Supermemory response");
  }
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      !!entry && typeof entry === "object" && !Array.isArray(entry)
  );
}
function metadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function publicReceipt(row: Receipt) {
  return {
    createdAt: row.created_at,
    id: row.id,
    source: row.source,
    state: row.state,
    title: row.title,
  };
}
function textInput(input: Input, kind: Kind) {
  const content = required(
    input.content,
    "content",
    kind === "memory" ? 10_000 : 262_144
  );
  if (
    Buffer.byteLength(content, "utf8") > 262_144 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(content) ||
    /^https?:\/\/\S+$/i.test(content)
  ) {
    throw new Error("Submit plain UTF-8 text, not a URL or binary file");
  }
  return content;
}

export async function run(input: Input, context: Context): Promise<unknown> {
  if (context.actor.role === "viewer") {
    throw new Error("Member access required");
  }
  if (!context.databasePath) {
    throw new Error("Plugin database unavailable");
  }
  const db = new Database(context.databasePath);
  db.exec("PRAGMA busy_timeout = 5000");
  const externalSettingsPath = join(context.dataDir, "connection.json");
  const managed = !existsSync(externalSettingsPath);
  const workerDir = join(context.dataDir, "workers", "server");
  const settingsPath = managed
    ? join(workerDir, "connection.json")
    : externalSettingsPath;
  let worker: { state: string; message?: string } = { state: "starting" };
  if (managed && existsSync(join(workerDir, "status.json"))) {
    worker = JSON.parse(readFileSync(join(workerDir, "status.json"), "utf8"));
  }
  const action = context.actionKey;
  try {
    const namespace = db
      .transaction(() => {
        db.query("INSERT OR IGNORE INTO dataset VALUES (1, ?, ?)").run(
          randomUUID(),
          context.orgId
        );
        const row = db
          .query<{ namespace: string; org_id: string }, []>(
            "SELECT * FROM dataset WHERE id = 1"
          )
          .get()!;
        if (row.org_id !== context.orgId) {
          throw new Error(
            "Dataset belongs to another organization; use a fresh installation and re-ingest content"
          );
        }
        return row.namespace;
      })
      .immediate();
    function connection(): Connection | undefined {
      if ((managed && worker.state !== "ready") || !existsSync(settingsPath)) {
        return;
      }
      chmodSync(settingsPath, 0o600);
      try {
        const value = JSON.parse(
          readFileSync(settingsPath, "utf8")
        ) as Connection;
        return {
          token: required(value.token, "token", 4096),
          url: normalizeUrl(value.url),
        };
      } catch {
        throw new Error("Connection settings could not be read");
      }
    }
    if (
      ["get_settings", "save_settings", "check_connection"].includes(
        action ?? ""
      ) &&
      context.actor.role !== "admin"
    ) {
      throw new Error("Admin access required");
    }
    if (action === "save_settings") {
      if (managed && existsSync(workerDir)) {
        throw new Error("This connection is managed by Nakama Workers");
      }
      const url = normalizeUrl(required(input.url, "server URL", 2048));
      return db
        .transaction(() => {
          const old = connection();
          if (
            old?.url !== url &&
            db.query("SELECT id FROM receipts LIMIT 1").get()
          ) {
            throw new Error("Cannot change servers after saving content");
          }
          const token = input.token
            ? required(input.token, "token", 4096)
            : old?.url === url
              ? old.token
              : undefined;
          if (!token || /\s/.test(token)) {
            throw new Error("A replacement token is required");
          }
          const temporary = `${externalSettingsPath}.${randomUUID()}.tmp`;
          writeFileSync(temporary, JSON.stringify({ token, url }), {
            flag: "wx",
            mode: 0o600,
          });
          renameSync(temporary, externalSettingsPath);
          return { configured: true, url };
        })
        .immediate();
    }
    const config = connection();
    if (action === "get_settings") {
      return { configured: !!config, url: config?.url ?? "" };
    }
    if (action === "profiles") {
      return {
        canConfigure: context.actor.role === "admin" && !managed,
        managed,
        ...(managed ? { worker } : {}),
        configured: !!config,
        profiles: await context.host({ op: "profiles" }),
      };
    }
    if (!config) {
      throw new Error(
        managed
          ? worker.message ||
              "Supermemory is starting. Check its status in Workers."
          : "Ask an admin to connect Supermemory in plugin settings"
      );
    }
    let client = new SupermemoryClient(config);
    if (action === "check_connection") {
      await client.request("POST", "/v3/documents/list", {
        containerTags: [
          `nakama_${hash([namespace, context.orgId, "connection-check"])}`,
        ],
        limit: 1,
      });
      return { connected: true };
    }
    const profileId = context.profileId ?? required(input.agentId, "agent");
    if (
      context.profileId &&
      input.agentId !== undefined &&
      input.agentId !== context.profileId
    ) {
      throw new Error("Agent conflicts with tool context");
    }
    const profiles = records(await context.host({ op: "profiles" }));
    if (!profiles.some((profile) => profile.id === profileId)) {
      throw new Error("Agent unavailable");
    }
    const kind: Kind = [
      "remember",
      "search_memory",
      "list_memories",
      "forget_memory",
    ].includes(action ?? "")
      ? "memory"
      : "knowledge";
    const tag = `nakama_${hash([namespace, context.orgId, profileId, kind])}`;
    function rowById(id: string): Receipt {
      const row = db
        .query<Receipt, [string, string, string]>(
          "SELECT * FROM receipts WHERE id = ? AND profile_id = ? AND kind = ?"
        )
        .get(id, profileId, kind);
      if (!row) {
        throw new Error("Item not found for this agent");
      }
      return row;
    }
    function update(
      row: Receipt,
      state: string,
      upstreamId = row.upstream_id
    ): Receipt {
      // A read or a late creation response must never undo a concurrent deletion.
      db.query(
        "UPDATE receipts SET state = CASE WHEN state IN ('deleting','deleted','forgotten') THEN state ELSE ? END, upstream_id = COALESCE(?, upstream_id), updated_at = ? WHERE id = ?"
      ).run(state, upstreamId, Date.now(), row.id);
      return rowById(row.id);
    }
    const ownsMemory = (entry: Record<string, unknown>, row: Receipt) =>
      entry.id === row.upstream_id &&
      metadata(entry.metadata).nakamaContainer === tag &&
      metadata(entry.metadata).nakamaOperation === row.custom_id;
    async function memoryPage(row: Receipt) {
      const response = await client.request("POST", "/v4/memories/list", {
        containerTags: [tag],
        filters: { AND: [{ key: "nakamaOperation", value: row.custom_id }] },
        limit: 20,
      });
      return records(response.memoryEntries);
    }
    async function ownedDocument(row: Receipt) {
      let upstreamId = row.upstream_id;
      if (!upstreamId) {
        const listed = await client.request("POST", "/v3/documents/list", {
          containerTags: [tag],
          filters: { AND: [{ key: "nakamaOperation", value: row.custom_id }] },
          limit: 2,
        });
        const matches = records(listed.memories);
        if (matches.length !== 1) {
          throw new SupermemoryError(404, "Document outcome unresolved");
        }
        upstreamId = required(matches[0]!.id, "document ID");
      }
      const document = await client.request(
        "GET",
        `/v3/documents/${encodeURIComponent(upstreamId)}`
      );
      if (
        !(
          Array.isArray(document.containerTags) &&
          document.containerTags.includes(tag)
        ) ||
        document.customId !== row.custom_id ||
        (row.upstream_id && document.id !== row.upstream_id)
      ) {
        throw new Error("Supermemory document ownership could not be verified");
      }
      return document;
    }
    async function refresh(row: Receipt): Promise<Receipt> {
      if (
        row.state === "deleted" ||
        (row.state === "submitting" && Date.now() - row.updated_at < 30_000)
      ) {
        return row;
      }
      if (kind === "knowledge") {
        try {
          const document = await ownedDocument(row);
          return update(
            row,
            document.status === "done"
              ? "ready"
              : document.status === "failed"
                ? "failed"
                : "pending",
            required(document.id, "document ID")
          );
        } catch (error) {
          if (error instanceof SupermemoryError && error.status === 404) {
            return update(row, "unknown");
          }
          throw error;
        }
      }
      if (!["unknown", "submitting"].includes(row.state)) {
        return row;
      }
      const matches = (await memoryPage(row)).filter(
        (entry) =>
          metadata(entry.metadata).nakamaContainer === tag &&
          metadata(entry.metadata).nakamaOperation === row.custom_id
      );
      if (matches.length !== 1) {
        return update(row, "unknown");
      }
      return update(
        row,
        matches[0]!.isForgotten ? "forgotten" : "ready",
        required(matches[0]!.id, "memory ID")
      );
    }
    if (action === "remember" || action === "add_document") {
      const content = textInput(input, kind);
      const title =
        kind === "memory" ? content : required(input.title, "title", 200);
      const source =
        input.source === undefined
          ? ""
          : required(input.source, "source", 2048);
      const operationKey = required(input.submissionKey, "submission key", 100);
      const payloadHash = hash([content, title, source]);
      const reserved = db
        .transaction(() => {
          // Snapshot settings under the same process-shared lock as receipt reservation.
          const snapshot = connection();
          if (!snapshot) {
            throw new Error("Connection unavailable");
          }
          const previous = db
            .query<Receipt, [string, string, string]>(
              "SELECT * FROM receipts WHERE profile_id = ? AND kind = ? AND operation_key = ?"
            )
            .get(profileId, kind, operationKey);
          if (previous) {
            if (previous.payload_hash !== payloadHash) {
              throw new Error(
                "Submission key already used for different content"
              );
            }
            return { created: false, row: previous, snapshot };
          }
          const id = randomUUID();
          db.query(
            "INSERT INTO receipts VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 'submitting', ?, ?)"
          ).run(
            id,
            profileId,
            kind,
            operationKey,
            payloadHash,
            `nk_${hash([tag, operationKey])}`,
            title,
            source,
            Date.now(),
            Date.now()
          );
          return { created: true, row: rowById(id), snapshot };
        })
        .immediate();
      client = new SupermemoryClient(reserved.snapshot);
      if (!reserved.created) {
        return publicReceipt(await refresh(reserved.row));
      }
      const row = reserved.row;
      const meta = {
        nakamaContainer: tag,
        nakamaOperation: row.custom_id,
        source,
        title,
      };
      try {
        const response = await client.request(
          "POST",
          kind === "memory" ? "/v4/memories" : "/v3/documents",
          kind === "memory"
            ? {
                containerTag: tag,
                memories: [{ content, isStatic: false, metadata: meta }],
              }
            : {
                containerTag: tag,
                content,
                customId: row.custom_id,
                metadata: meta,
                taskType: "superrag",
              }
        );
        const id =
          kind === "memory" ? records(response.memories)[0]?.id : response.id;
        return publicReceipt(
          update(
            row,
            kind === "memory" ? "ready" : "pending",
            required(id, "upstream ID")
          )
        );
      } catch {
        return {
          ...publicReceipt(update(row, "unknown")),
          message:
            "Outcome unknown. Retry this submission key to reconcile; do not automatically save with a new key.",
        };
      }
    }
    if (action === "list_memories" || action === "list_documents") {
      if (action === "list_memories" && input.id !== undefined) {
        return {
          items: [
            publicReceipt(
              await refresh(rowById(required(input.id, "item ID", 100)))
            ),
          ],
        };
      }
      const page = input.page === undefined ? 1 : Number(input.page);
      if (!Number.isInteger(page) || page < 1 || page > 100_000) {
        throw new Error("Invalid page");
      }
      const rows = db
        .query<Receipt, [string, string, number]>(
          "SELECT * FROM receipts WHERE profile_id = ? AND kind = ? AND state NOT IN ('deleted','forgotten') ORDER BY created_at DESC, id LIMIT 21 OFFSET ?"
        )
        .all(profileId, kind, (page - 1) * 20);
      // Refresh individually from the UI to keep each invocation bounded to one upstream request.
      return {
        hasMore: rows.length > 20,
        items: rows
          .slice(0, 20)
          .map((row) =>
            publicReceipt(
              row.state === "submitting" &&
                Date.now() - row.updated_at >= 30_000
                ? update(row, "unknown")
                : row
            )
          ),
        page,
      };
    }
    if (action === "get_document") {
      const row = rowById(required(input.id, "item ID", 100));
      const refreshed = await refresh(row);
      return publicReceipt(refreshed);
    }
    if (action === "search_memory" || action === "search_knowledge") {
      const query = required(input.query, "query", 4000);
      const limit = input.limit === undefined ? 10 : Number(input.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
        throw new Error("Limit must be 1–20");
      }
      const response = await client.request(
        "POST",
        kind === "memory" ? "/v4/search" : "/v3/search",
        kind === "memory"
          ? {
              containerTag: tag,
              include: { forgottenMemories: false },
              limit,
              q: query,
              searchMode: "memories",
            }
          : { containerTags: [tag], limit, q: query }
      );
      const items = [];
      for (const entry of records(response.results).slice(0, limit)) {
        const remoteId = kind === "memory" ? entry.id : entry.documentId;
        if (typeof remoteId !== "string") {
          continue;
        }
        const row = db
          .query<Receipt, [string, string, string]>(
            "SELECT * FROM receipts WHERE profile_id = ? AND kind = ? AND upstream_id = ? AND state IN ('ready','pending')"
          )
          .get(profileId, kind, remoteId);
        if (!row) {
          continue;
        }
        if (kind === "memory") {
          if (
            !ownsMemory(entry, row) ||
            entry.isForgotten === true ||
            typeof entry.memory !== "string"
          ) {
            continue;
          }
          items.push({
            ...publicReceipt(row),
            excerpt: entry.memory.slice(0, 10_000),
          });
        } else {
          // The search hit must carry the metadata written with this owned receipt.
          if (
            metadata(entry.metadata).nakamaContainer !== tag ||
            metadata(entry.metadata).nakamaOperation !== row.custom_id
          ) {
            continue;
          }
          const excerpt = records(entry.chunks)
            .flatMap((chunk) =>
              chunk.isRelevant !== false && typeof chunk.content === "string"
                ? [chunk.content]
                : []
            )
            .join("\n")
            .slice(0, 16_000);
          if (excerpt) {
            items.push({ ...publicReceipt(row), excerpt });
          }
        }
      }
      return { items };
    }
    if (action === "forget_memory" || action === "delete_document") {
      let row = rowById(required(input.id, "item ID", 100));
      if (["deleted", "forgotten"].includes(row.state)) {
        return publicReceipt(row);
      }
      if (!row.upstream_id) {
        row = await refresh(row);
      }
      if (!row.upstream_id) {
        throw new Error(
          "Save outcome is unresolved; reconcile the original submission before deleting"
        );
      }
      db.query(
        "UPDATE receipts SET state = 'deleting', updated_at = ? WHERE id = ? AND state NOT IN ('deleted','forgotten')"
      ).run(Date.now(), row.id);
      try {
        if (kind === "memory") {
          const entries = await memoryPage(row);
          const entry = entries.find((candidate) => ownsMemory(candidate, row));
          if (!entry) {
            throw new Error(
              "Memory ownership could not be verified in the current page"
            );
          }
          if (!entry.isForgotten) {
            await client.request("DELETE", "/v4/memories", {
              containerTag: tag,
              id: row.upstream_id,
            });
          }
        } else {
          try {
            await ownedDocument(row);
            await client.request(
              "DELETE",
              `/v3/documents/${encodeURIComponent(row.upstream_id)}`
            );
          } catch (error) {
            if (!(error instanceof SupermemoryError && error.status === 404)) {
              throw error;
            }
          }
        }
        db.query(
          "UPDATE receipts SET state = ?, updated_at = ? WHERE id = ?"
        ).run(kind === "memory" ? "forgotten" : "deleted", Date.now(), row.id);
        return publicReceipt(rowById(row.id));
      } catch {
        return {
          ...publicReceipt(rowById(row.id)),
          message:
            "Excluded from plugin search. Remote removal is pending; retry this item.",
        };
      }
    }
    throw new Error("Unknown Supermemory action");
  } finally {
    db.close();
  }
}
