# Agent-managed knowledge base index

## Goal

Give each profile an agent-written `knowledge-base/index.md` that maps user topics and related terms to source documents. The agent reads relevant index sections on demand, then searches the source before answering.

The index is a navigation aid. Uploaded documents remain the source of facts. `MEMORY.md` and organization memory keep their current roles.

## Current behavior

- `packages/core/src/knowledge-base/store.ts` stores uploaded files, extracted text, and document metadata. Documents can belong to one profile or to an organization and be attached to a profile.
- `packages/core/src/knowledge-base/catalog.ts` adds a list of ready document names to the system prompt. It does not describe their topics.
- `packages/core/src/tools/knowledge-base-search.ts` searches extracted text from ready profile documents and attached organization documents. A file name alone does not always identify the right source.
- `AgentService.resolveProfileSystemPrompt` adds the catalog to chat and other agent runs.

## User flow

1. An organization admin enables indexing after seeing which configured model will read document text and the input and output limits.
2. An admin uploads or removes a document, or changes which organization documents a profile can use.
3. Nakama removes any stale index before the change returns. Chat remains available through the current document list.
4. The indexing task analyzes only new or changed sources. Nakama rebuilds each affected profile's `index.md` from saved source entries.
5. The agent sees a short notice that an index is available. It reads relevant sections when needed, then searches the linked source.
6. If indexing fails, the agent sees the current document list and can still search the documents.

## Index contract

- Store one `index.md` inside each profile's existing `knowledge-base/` directory. Do not create a new data store or Git repository.
- Group entries by useful topics. One document can have several topics. Each entry has a short description, related terms, and a stable document ID with its scope (`profile` or `organization`).
- Keep the full index on disk. Return at most 1,500 index bytes per read. Do not put index content in every system prompt.
- Use the current ready-document list as the authority for access. Never include an unattached organization document in a profile index.
- Keep generated descriptions limited to what the source supports. Mark unclear topics as unclear. Do not copy source instructions into the agent's operating instructions.
- Record the source-set revision and index-file hash in server-owned metadata. A revision covers IDs, scope, status, and content hashes. A mismatch or changed file means the index is stale. A source without an entry makes the index incomplete; show its coverage count.
- The model returns bounded topic fields, not free-form Markdown. Nakama validates them and writes `index.md`. Built-in file tools cannot read or change the index or its metadata; agents use the bounded index tool.

Example shape:

```md
# Knowledge index

## Billing
- Refund rules and exceptions; also called returns or repayment. Sources: `profile:kb_123` (policy.pdf).
- Invoice dates and payment terms. Sources: `organization:kb_456` (billing-guide.md).
```

The exact topics and related terms come from the agent. The IDs come from Nakama's document metadata.

## Implementation

1. **Store and revision:** Add index read/write helpers beside the current knowledge-base store. Store each document's generated topics in a server-owned sidecar file keyed by its ID and content hash. This avoids concurrent writes to the existing manifest. Store the index revision and file hash outside the Markdown file. Replace the index atomically; publish the matching metadata last. Keep the existing upload, delete, attach, and detach APIs.
2. **Consent and model:** Indexing starts disabled for each organization. An admin enables it in Knowledge and sees the selected configured provider, the ready-document count, and the input and output limits for the selected batch. Existing documents require an explicit backfill action. Use the server's configured default provider for both profile and shared documents, without applying a profile's soul or instructions. Count calls against existing organization usage limits. If no suitable model is configured, report `Needs setup` and keep ordinary search working. Disabling indexing stops new model calls and makes the index tool return `Off`.
3. **Update trigger and recovery:** Persist pending document IDs and their approved batch allowance when an enabled organization adds documents or an admin starts a backfill. A missing sidecar alone does not authorize a model call. After a successful change, process approved work in the existing server process. On server start, resume only persisted approved work within its remaining allowance. Claim work with an atomic per-organization lock in the existing data root, give calls a timeout, and make one model call at a time. An abandoned claim with no saved result has an unknown cost; charge its full reserved allowance and require admin retry. A revision mismatch needs only a rebuild from saved entries. Do not rely on an in-memory queue for recovery.
4. **Immediate removal and publication:** Use the same short consistency lock for knowledge-base mutations and index publication. Hold it while checking the current manifest revision and replacing or removing the index; never hold it during a model call. Invalidate the index for profile document delete, replacement, organization detach, and any other access-reducing mutation. Remove the affected profile index file and revision before changing access. If removal fails, fail the mutation. The worker must recheck the source-set revision under this lock before publishing, so an old run cannot restore a detached source. After the manifest change, remove deleted document sidecars and rebuild from remaining saved entries without a model call. A failed mutation may leave the index absent; the document list remains usable.
5. **Provider limit and agent update:** `ProviderChatOptions` has no general output cap today. Add an optional `maxOutputTokens` and pass it through each provider adapter used for indexing. Verify the request body for each supported adapter. Indexing calls disable thinking, tools, and web search. Reject a provider/model that cannot enforce the cap. Ask the model for up to five topics per changed document, with short descriptions and related terms. Give it the current topic headings so it can reuse a fitting heading. Use extracted headings and bounded samples spread across the document. Save `partial` when sampling cannot cover it. Validate field lengths and plain-text shape; Nakama supplies source IDs and escapes model text when rendering Markdown. Recheck the document hash before saving. Shared documents get one summary in the organization store, reused by attached profiles.
6. **Discovery and reading:** Change `composeKnowledgeBaseCatalog` to show only the ready count, indexed count, and a short hint to use the index or full search. Add a read-only `knowledge_base_index` tool alongside `knowledge_base_search`. Assign it to profiles that already have knowledge search, including existing profiles, and keep future assignments paired. It returns headings first, or a requested topic section, with a 1,500-byte output cap and an offset for later pages. It validates the index hash, revision, and current source access on every call. If the index is stale or absent, it reports that state and points to full search. Present its output as untrusted navigation data, never as operating instructions. Do not block chat while indexing runs.
7. **Source selection:** Extend `knowledge_base_search` with an optional document ID and scope selector. Keep `filename` for existing callers; reject requests that supply both selectors. Resolve the ID against the current profile and attached organization manifests before reading any text. For an ID search, use the authorized local extracted file even when an optional search backend is active. A failed index lookup should lead to full document search.
8. **Visibility:** Show `Off`, `Updating`, `Partial`, `Ready`, `Needs retry`, or `Needs setup` beside Knowledge in the profile UI. Show indexed and ready document counts. Let an admin request a retry or a full rebuild and inspect the current Markdown. A full rebuild uses saved entries and no model calls. Only an explicit reanalysis can spend more tokens. Do not add a general wiki editor in this change.

The main touchpoints are `packages/core/src/knowledge-base/{store,catalog}.ts` for storage and discovery, `packages/core/src/tools/` for scoped index and source reads and file-tool guards, `packages/core/src/contract.ts` and supported provider adapters for output limits, `apps/server/src/services/{profile-service,agent-service}.ts` for mutations and model calls, the existing profile routes and client contract for admin controls, and `KnowledgeTab.tsx` for status. Cover single uploads, ZIP import, duplicate replacement, profile document deletion, organization upload/deletion, attach, and detach. Put access invalidation and pending-work records in the shared mutation path so no caller can bypass them. Process approved work from the server service that owns provider access.

## Token budget

- Send at most 4,000 UTF-8 bytes per document call, including instructions and format. Cap model output at 300 tokens. Select headings and samples across the document within that input limit. These are fixed starting limits, not user settings.
- Send at most 12,000 input bytes and 900 output tokens per background run. Stop a bulk import or backfill after 24,000 input bytes and 1,800 output tokens; leave remaining documents pending until an admin approves another batch. Reserve allowance before each call and charge the full cap if a call ends without usage data. Do not raise limits automatically.
- Enforce input byte limits before each model call and set the provider's output-token limit. Record actual usage when reported. If a provider cannot cap output, do not use it for indexing.
- Keep the discovery note within 300 prompt bytes and each index tool result within 1,500 bytes. Report total entries and the next offset when a result is partial.
- Reuse the saved entry when the document hash has not changed. Attaching, detaching, deleting, or chatting does not analyze source text again. A manual index rebuild also reuses these entries; only an explicit reanalysis spends model tokens again.
- Rebuild `index.md` from saved entries with code, without a model call. Do not regenerate every entry when one document changes.
- Do not use a model during ordinary chat to maintain the index. Search the original source only when a question needs it.
- Measure model calls and actual or estimated input/output tokens per indexing run. Show these totals in existing usage reporting so the limits can be checked.

## Failure and access rules

- If text extraction fails, do not add that document to the index. Keep its current failed status visible.
- If model generation fails, keep search available and show `Needs retry`.
- If a document is deleted or detached, remove the old index file before the access change. Do not expose its old entry through prompts, the UI, or file tools.
- Keep each index inside its profile and organization scope. A profile index can mention an organization document only while it is attached.
- Treat uploaded text as untrusted input during generation and retrieval. Source text cannot change tool instructions, access rules, or the index format.

## Acceptance checks

1. Upload a document with an unclear file name. The ready index identifies its topic and related terms. A related question leads the agent to search that document.
2. Attach an organization document to profile A. Its topic appears for A, but not profile B.
3. Detach or delete a document. Its entry disappears from index tool results at once, including while the rebuild is pending.
4. Change the source set during generation. The old result cannot replace a newer index.
5. Make index generation fail. Chat and `knowledge_base_search` still work from the current document list.
6. Supply source text that asks the agent to ignore its rules. The index does not adopt that instruction.
7. Add one document to a profile with many ready documents. Only the new document uses indexing tokens; unchanged documents use their saved entries.
8. Attach an indexed organization document. The profile index updates without another model call.
9. Upload a long document. The run stays within both input-byte and output-token limits, and a sampled entry says `partial`.
10. Restart the server during indexing. Completed hashes are reused. An interrupted model call needs admin retry and cannot spend another allowance automatically.
11. Disable indexing. Nakama makes no new indexing calls, and the index tool returns `Off`.
12. Delete or detach a shared document. After the mutation returns, that profile cannot read an old index entry through the index tool or the UI; built-in file tools cannot access index storage.
13. Import many documents. The task stops at its batch allowance, shows the pending count, and waits for admin approval before more model calls.
14. Enable indexing without starting a backfill. Existing unindexed documents cause no model calls, and the index shows its coverage count.
15. Publish an index while a detach runs. The old worker result cannot restore the detached document's entry.

Use focused tests around index revision, access checks, stale fallback, document-ID search, byte limits, and provider output caps. Run the relevant Bun tests, `bun run check`, and `bun run knip` before a PR.

## Scope boundary

This change adds navigation over existing documents. It does not add automatic chat memory, agent-written factual wiki pages, embeddings, a vector database, or Git synchronization. Add those only after the index shows a real retrieval gap.
