import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  getKnowledgeBaseDir,
  getKnowledgeBaseExtractedPath,
  getOrgPluginDataDir,
  getProfileSoulDir,
  getUserConfigDir,
  listKnowledgeBaseDocuments,
  type ToolContext,
} from "@nakama/core";
import { writeTextFile } from "@nakama/core/fs";
import {
  normalizeUrl,
  SupermemoryClient,
  SupermemoryError,
} from "@nakama/core/supermemory-client";
import type { DatabaseAdapter } from "@nakama/db";
import { withPluginDataLock } from "./plugin-service";

interface Entry {
  content: string;
  id: string;
}

interface Receipt {
  customId: string;
  hash: string;
  id: string;
}

interface State {
  namespace: string;
  pendingDeletes?: Record<string, Receipt & { tag: string }>;
  scopes: Record<string, Record<string, Receipt>>;
}

type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type SupermemoryDocument = { [key: string]: JsonValue };

interface SupermemorySearchRequest {
  containerTags: string[];
  filters?: { OR: Array<{ key: string; value: JsonValue }> };
  limit: number;
  q: string;
}

interface Options {
  configDir?: string;
  transport?: (url: string, init: RequestInit) => Promise<Response>;
}

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function* chunks(content: string) {
  let line = 1;

  for (let offset = 0; offset < content.length; ) {
    let end = Math.min(offset + 30_000, content.length);

    if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1]!)) {
      end--;
    }

    const text = content.slice(offset, end);
    yield { line, offset, text };
    line += text.split("\n").length - 1;
    offset = end;
  }
}

export class MemoryBackendService {
  constructor(
    private readonly db: Pick<DatabaseAdapter, "getOrgPlugin">,
    private readonly options: Options = {}
  ) {}

  toolContext(
    orgId: string,
    profileId: string
  ): Pick<ToolContext, "memoryFiles" | "searchKnowledge"> {
    const memoryRoot = getProfileSoulDir(orgId, profileId);

    const readMemoryFile = async (path: string, content: string) => {
      const root = await realpath(memoryRoot);
      const name = relative(root, path);

      return name === "MEMORY.md" ||
        /^memory-archive\/[0-9]{4}-[0-9]{2}\.md$/.test(name)
        ? this.readMemory(orgId, profileId, name, content)
        : content;
    };

    return {
      memoryFiles: {
        read: readMemoryFile,
        remove: async (path) => {
          await readMemoryFile(path, "");
        },
        write: async (path, content) => {
          await readMemoryFile(path, content);
        },
      },
      searchKnowledge: async (input) => {
        if (
          (await this.db.getOrgPlugin(orgId, "supermemory"))?.lifecycleState !==
          "enabled"
        ) {
          return null;
        }

        // Regex is an explicit request for exact text matching, not semantic retrieval.
        if (input.regex) {
          return null;
        }

        const entries = await this.knowledgeEntries(orgId, profileId);

        const selected = new Map(
          entries
            .filter(
              (entry) =>
                !input.filename ||
                entry.filename.toLowerCase() ===
                  input.filename.trim().toLowerCase()
            )
            .map((entry) => [entry.id, entry])
        );

        let hits = await this.search(
          orgId,
          `knowledge:${profileId}`,
          entries,
          input.query,
          input.maxResults,
          input.filename ? [...selected.keys()] : undefined
        );

        if (hits === null) {
          return null;
        }

        // Retry only empty results; provider and indexing failures remain explicit.
        const keywords = [
          ...new Set(input.query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []),
        ]
          .filter(
            (word) =>
              word.length >= 3 &&
              !/^(the|and|for|with|from|what|when|where|how|does|this|that|about|please|explain|find|search|document)$/.test(
                word
              )
          )
          .slice(0, 8);

        const retries = [
          ...new Set([keywords.slice(0, 2).join(" "), keywords[0] ?? ""]),
        ].filter((query) => query && query !== input.query.toLowerCase());

        for (const query of retries) {
          if (hits.length || !selected.size) {
            break;
          }

          hits = await this.search(
            orgId,
            `knowledge:${profileId}`,
            entries,
            query,
            input.maxResults,
            [...selected.keys()]
          );

          if (hits === null) {
            return null;
          }
        }

        if (!hits.length && keywords.length) {
          const limit = Math.min(input.maxResults, 100);
          const matches: { file: string; line: number; text: string }[] = [];

          for (const entry of selected.values()) {
            const lines = entry.content.split("\n");

            for (let index = 0; index < lines.length; index++) {
              const text = lines[index]!;

              if (
                entry.line + index <= 3 ||
                !text.toLowerCase().includes(keywords[0]!)
              ) {
                continue;
              }

              matches.push({
                file: entry.file,
                line: entry.line + index,
                text: text.slice(0, 16_000),
              });

              if (matches.length > limit) {
                return { matches: matches.slice(0, limit), truncated: true };
              }
            }
          }

          return { matches, truncated: false };
        }

        return {
          matches: hits.flatMap((hit) => {
            const entry = selected.get(hit.id);

            return entry
              ? [{ file: entry.file, line: entry.line, text: hit.text }]
              : [];
          }),
          truncated: hits.length >= Math.min(input.maxResults, 100),
        };
      },
    };
  }

  async syncKnowledge(orgId: string, profileId: string): Promise<void> {
    if (
      (await this.db.getOrgPlugin(orgId, "supermemory"))?.lifecycleState !==
      "enabled"
    ) {
      return;
    }

    await this.withScope(
      orgId,
      `knowledge:${profileId}`,
      await this.knowledgeEntries(orgId, profileId),
      async () => undefined
    );
  }

  private async knowledgeEntries(orgId: string, profileId: string) {
    const entries: (Entry & {
      filename: string;
      file: string;
      line: number;
    })[] = [];

    for (const document of await listKnowledgeBaseDocuments(orgId, profileId)) {
      if (document.status !== "ready") {
        continue;
      }

      const file = getKnowledgeBaseExtractedPath(
        getKnowledgeBaseDir(orgId, profileId),
        document.id
      );

      const content = await readFile(file, "utf8");
      // Preserve the full document so Supermemory chooses semantic boundaries.
      entries.push({
        content,
        file: relative(getProfileSoulDir(orgId, profileId), file),
        filename: document.filename,
        id: document.id,
        line: 1,
      });
    }

    return entries;
  }

  async readMemory(
    orgId: string,
    profileId: string | null,
    filename: string,
    content: string
  ): Promise<string> {
    // Preserve the existing namespace for ordinary profile memory documents.
    const scope = JSON.stringify(["memory", profileId, "profile", filename]);
    const entries: Entry[] = [];

    for (const chunk of chunks(content)) {
      entries.push({
        // Supermemory trims text on ingestion; JSON preserves exact file bytes.
        content: JSON.stringify(chunk.text),
        id: `${filename}:${chunk.offset}`,
      });
    }

    return (
      (await this.withScope(
        orgId,
        scope,
        entries,
        async (_client, _tag, documents) => {
          const text = [...documents.values()]
            .map((document) => {
              if (!isString(document.content)) {
                throw new Error("Supermemory memory content is unavailable");
              }

              const value: unknown = JSON.parse(document.content);

              if (!isString(value)) {
                throw new Error("Invalid Supermemory memory content");
              }

              return value;
            })
            .join("");

          if (text !== content) {
            throw new Error("Supermemory did not return the saved memory text");
          }

          return text;
        }
      )) ?? content
    );
  }

  async search(
    orgId: string,
    scope: string,
    entries: Entry[],
    query: string,
    limit: number,
    selectedIds?: string[]
  ): Promise<{ id: string; text: string }[] | null> {
    return this.withScope(
      orgId,
      scope,
      entries,
      async (client, tag, documents) => {
        if (entries.length === 0 || selectedIds?.length === 0) {
          return [];
        }

        const selected = selectedIds ? new Set(selectedIds) : null;

        const searched = [...documents].filter(
          ([id]) => !selected || selected.has(id)
        );

        if (searched.some(([, doc]) => doc.status === "failed")) {
          throw new Error(
            "Supermemory indexing failed. Check the worker provider configuration."
          );
        }

        if (searched.some(([, doc]) => doc.status !== "done")) {
          throw new Error(
            "Supermemory is still indexing this memory. Retry shortly."
          );
        }

        const searchRequest: SupermemorySearchRequest = {
          containerTags: [tag],
          limit: Math.min(limit, 100),
          q: query,
        };

        if (selected) {
          searchRequest.filters = {
            OR: searched.map(([, doc]) => ({
              key: "nakamaOperation",
              value: doc.customId,
            })),
          };
        }

        const result = await readSupermemoryDocument(
          await client.request("POST", "/v3/search", searchRequest)
        );

        if (!(result && Array.isArray(result.results))) {
          throw new Error("Invalid Supermemory search response");
        }

        const owned = new Map(
          searched.map(([id, doc]) => [doc.id, { doc, id }])
        );

        const matches: { id: string; text: string }[] = [];

        for (const hitValue of result.results) {
          const hit = readSupermemoryDocument(hitValue);
          const documentId = hit?.documentId;

          if (!(hit && isString(documentId))) {
            continue;
          }

          const metadata = readSupermemoryDocument(hit.metadata);
          const match = owned.get(documentId);

          if (
            !match ||
            metadata?.nakamaContainer !== tag ||
            metadata.nakamaOperation !== match.doc.customId
          ) {
            continue;
          }

          if (!Array.isArray(hit.chunks)) {
            continue;
          }

          const text = hit.chunks
            .flatMap((chunkValue) => {
              const chunk = readSupermemoryDocument(chunkValue);

              return chunk &&
                chunk.isRelevant !== false &&
                isString(chunk.content)
                ? [chunk.content]
                : [];
            })
            .join("\n")
            .slice(0, 16_000);

          if (text) {
            matches.push({ id: match.id, text });
          }
        }

        return matches.slice(0, limit);
      }
    );
  }

  private async withScope<T>(
    orgId: string,
    scope: string,
    entries: Entry[],
    run: (
      client: SupermemoryClient,
      tag: string,
      documents: Map<string, SupermemoryDocument>
    ) => Promise<T>
  ): Promise<T | null> {
    const directory = getOrgPluginDataDir(
      orgId,
      "supermemory",
      this.options.configDir ?? getUserConfigDir()
    );

    if (
      (await this.db.getOrgPlugin(orgId, "supermemory"))?.lifecycleState !==
      "enabled"
    ) {
      return null;
    }

    return withPluginDataLock(directory, async () => {
      const plugin = await this.db.getOrgPlugin(orgId, "supermemory");

      if (plugin?.lifecycleState !== "enabled") {
        return null;
      }

      const statePath = join(directory, "memory-backend.json");
      const saved = await this.readJson(statePath);

      const state: State = parseState(saved) ?? {
        namespace: randomUUID(),
        scopes: {},
      };

      const external = await this.readJson(join(directory, "connection.json"));
      let connection = external;

      if (!external) {
        const worker = await this.readJson(
          join(directory, "workers/server/status.json")
        );

        if (worker?.state !== "ready") {
          // Until the first migration, the built-in backend remains selected.
          if (!saved) {
            return null;
          }

          throw new Error(
            "Supermemory is unavailable. Restart it in Workers or disable the plugin to use local memory."
          );
        }

        connection = await this.readJson(
          join(directory, "workers/server/connection.json")
        );
      }

      if (
        !(
          connection &&
          isString(connection.url) &&
          isString(connection.token) &&
          connection.token.trim()
        )
      ) {
        throw new Error("Supermemory connection is unavailable");
      }

      const client = new SupermemoryClient(
        { token: connection.token, url: normalizeUrl(connection.url) },
        this.options.transport,
        // Whole extracted documents can exceed the default small-response budget.
        scope.startsWith("knowledge:") ? 128 * 1024 * 1024 : undefined
      );

      // Persist the namespace before HTTP so uncertain writes retry with the same IDs.
      if (!saved) {
        await writeTextFile(statePath, JSON.stringify(state));
      }

      const tag = `nakama_backend_${hash(JSON.stringify([state.namespace, orgId, scope]))}`;
      const receipts = state.scopes[scope] ?? {};
      state.scopes[scope] = receipts;
      const documents = new Map<string, SupermemoryDocument>();

      const wanted = new Map(
        entries.map((entry) => [
          entry.id,
          hash(
            isString(connection.revision)
              ? JSON.stringify([entry.content, connection.revision])
              : entry.content
          ),
        ])
      );

      const pendingDeletes = state.pendingDeletes ?? {};
      state.pendingDeletes = pendingDeletes;
      let retired = false;

      for (const entry of entries) {
        // Undo can make a retired immutable version current again.
        const customId = hash(
          JSON.stringify([tag, entry.id, wanted.get(entry.id)])
        );

        if (pendingDeletes[customId]) {
          delete pendingDeletes[customId];
          retired = true;
        }
      }

      // Retire before HTTP: queued documents cannot be deleted yet, but must
      // immediately stop participating in recall. Keep cleanup durable.
      for (const [id, receipt] of Object.entries(receipts)) {
        if (wanted.get(id) === receipt.hash) {
          continue;
        }

        pendingDeletes[receipt.customId] = { ...receipt, tag };
        delete receipts[id];
        retired = true;
      }

      if (retired) {
        await writeTextFile(statePath, JSON.stringify(state));
      }

      for (const receipt of Object.values(pendingDeletes).slice(0, 20)) {
        try {
          const old = await client.request(
            "GET",
            `/v3/documents/${encodeURIComponent(receipt.id)}`
          );

          this.assertOwned(old, receipt.tag, receipt.customId);
          await client.request(
            "DELETE",
            `/v3/documents/${encodeURIComponent(receipt.id)}`
          );
        } catch (error) {
          if (error instanceof SupermemoryError && error.status === 409) {
            continue;
          }

          if (!(error instanceof SupermemoryError && error.status === 404)) {
            throw error;
          }
        }

        delete pendingDeletes[receipt.customId];
        await writeTextFile(statePath, JSON.stringify(state));
      }

      for (const entry of entries) {
        const digest = wanted.get(entry.id)!;
        const customId = hash(JSON.stringify([tag, entry.id, digest]));
        let receipt = receipts[entry.id];

        if (!receipt) {
          receipt = { customId, hash: digest, id: customId };
          receipts[entry.id] = receipt;
          await writeTextFile(statePath, JSON.stringify(state));
        }

        let document: SupermemoryDocument;

        try {
          document = await readSupermemoryDocument(
            await client.request(
              "GET",
              `/v3/documents/${encodeURIComponent(receipt.id)}`
            )
          );
        } catch (error) {
          if (!(error instanceof SupermemoryError && error.status === 404)) {
            throw error;
          }

          const response = await readSupermemoryDocument(
            await client.request("POST", "/v3/documents", {
              containerTags: [tag],
              content: entry.content || "\n",
              customId,
              metadata: { nakamaContainer: tag, nakamaOperation: customId },
              taskType: scope.startsWith("knowledge:") ? "superrag" : "memory",
            })
          );

          if (!(isString(response.id) && response.id)) {
            throw new Error(
              "Supermemory did not acknowledge the saved document"
            );
          }

          receipt.id = response.id;
          await writeTextFile(statePath, JSON.stringify(state));
          document = await readSupermemoryDocument(
            await client.request(
              "GET",
              `/v3/documents/${encodeURIComponent(receipt.id)}`
            )
          );
        }

        this.assertOwned(document, tag, customId);

        if (entry.content === "" && document.content === "\n") {
          document.content = "";
        }

        documents.set(entry.id, document);
      }

      return run(client, tag, documents);
    });
  }

  private assertOwned(
    document: SupermemoryDocument,
    tag: string,
    customId: string
  ): void {
    if (
      !(
        Array.isArray(document.containerTags) &&
        document.containerTags.includes(tag)
      ) ||
      document.customId !== customId
    ) {
      throw new Error("Supermemory document ownership could not be verified");
    }
  }

  private async readJson(path: string): Promise<SupermemoryDocument | null> {
    try {
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      const document = readSupermemoryDocument(value);

      if (!document) {
        throw new Error("Invalid saved memory backend data.");
      }

      return document;
    } catch (error) {
      if (getNodeErrorCode(error) === "ENOENT") {
        return null;
      }

      throw error;
    }
  }
}

function parseState<T>(value: T | null): State | undefined {
  const record = value === null ? undefined : readSupermemoryDocument(value);

  if (!(record && isString(record.namespace))) {
    return;
  }

  const scopes = readSupermemoryDocument(record.scopes);

  if (!scopes) {
    return;
  }

  const parsedScopes: State["scopes"] = {};

  for (const [scope, receiptsValue] of Object.entries(scopes)) {
    const receipts = readSupermemoryDocument(receiptsValue);

    if (!receipts) {
      return;
    }

    const parsedReceipts: Record<string, Receipt> = {};

    for (const [id, receiptValue] of Object.entries(receipts)) {
      const receipt = readSupermemoryDocument(receiptValue);

      if (
        !(
          receipt &&
          isString(receipt.customId) &&
          isString(receipt.hash) &&
          isString(receipt.id)
        )
      ) {
        return;
      }

      parsedReceipts[id] = {
        customId: receipt.customId,
        hash: receipt.hash,
        id: receipt.id,
      };
    }

    parsedScopes[scope] = parsedReceipts;
  }

  const pendingDeletes: NonNullable<State["pendingDeletes"]> = {};
  const pending = readSupermemoryDocument(record.pendingDeletes);

  if (pending) {
    for (const [customId, receiptValue] of Object.entries(pending)) {
      const receipt = readSupermemoryDocument(receiptValue);

      if (
        !(
          receipt &&
          isString(receipt.customId) &&
          isString(receipt.hash) &&
          isString(receipt.id) &&
          isString(receipt.tag)
        )
      ) {
        return;
      }

      pendingDeletes[customId] = {
        customId: receipt.customId,
        hash: receipt.hash,
        id: receipt.id,
        tag: receipt.tag,
      };
    }
  }

  return {
    namespace: record.namespace,
    pendingDeletes,
    scopes: parsedScopes,
  };
}

function readSupermemoryDocument<T>(value: T): SupermemoryDocument | undefined {
  if (!(value instanceof Object)) {
    return;
  }

  const entries: Array<[string, JsonValue]> = [];

  for (const [key, entry] of Object.entries(value)) {
    const parsed = readJsonValue(entry);

    if (parsed === undefined) {
      return;
    }

    entries.push([key, parsed]);
  }

  return Object.fromEntries(entries);
}

function readJsonValue<T>(value: T): JsonValue | undefined {
  const tag = Object.prototype.toString.call(value);

  if (
    value === null ||
    tag === "[object String]" ||
    tag === "[object Boolean]"
  ) {
    // SAFETY: The primitive tag check matches JsonValue's string and boolean members.
    return value as JsonValue;
  }

  if (tag === "[object Number]" && Number.isFinite(value)) {
    // SAFETY: The primitive tag and finite check match JsonValue's number member.
    return value as JsonValue;
  }

  if (Array.isArray(value)) {
    const entries = value.map(readJsonValue);

    if (entries.some((entry) => entry === undefined)) {
      return;
    }

    // SAFETY: The check above excludes every undefined parse result.
    return entries as JsonValue[];
  }

  const record = readSupermemoryDocument(value);

  return record;
}

function getNodeErrorCode<T>(error: T): string | undefined {
  if (!(error instanceof Error && "code" in error)) {
    return;
  }

  const code = error.code;

  return isString(code) ? code : undefined;
}

function isString<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}
