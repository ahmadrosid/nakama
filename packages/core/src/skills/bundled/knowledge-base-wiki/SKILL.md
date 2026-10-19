---
name: knowledge-base-wiki
description: Compile this profile's uploaded knowledge base documents into a wiki of markdown pages under knowledge-base/wiki/, and refresh it after documents are added, replaced or deleted. Use when the user asks to build, compile, update or rebuild the knowledge base wiki.
---

The wiki turns uploaded documents into pages you maintain, so a question is answered from one compiled page instead of re-reading every source. `knowledge_base_search` already searches `knowledge-base/wiki/*.md` next to the documents. Nothing else is needed for the pages to be found.

Three layers, each with one owner:

- **Sources.** `knowledge-base/manifest.json` and the `<id>.extracted.txt` files beside it. The user owns them through uploads. Never write, edit or delete anything in `knowledge-base/` outside `wiki/`.
- **Wiki.** `knowledge-base/wiki/*.md`. You own these. They are derived from the sources, so deleting the folder loses nothing.
- **Schema.** `knowledge-base/wiki/SCHEMA.md`. Says what pages exist and how they are shaped. You write it on the first compile and keep it current.

## Reading the sources

1. `read_file` `knowledge-base/manifest.json`. It holds `documents`, a list of `{ id, filename, status, uploadedAt, ... }`.
2. Only documents with `status: "ready"` have text. Their text is in `knowledge-base/<id>.extracted.txt`. The first three lines are a `# source:` / `# mediaType:` / `# uploadedAt:` header; the body follows.
3. Use `read_file` with `offset` and `limit` for long documents. Do not open the stored originals (`<id>--<filename>`); the extracted text is the source of truth.

A replaced document gets a new id, so "changed" and "deleted" look the same here: an id a page cites is no longer in the ready set.

## Page format

Every page except `SCHEMA.md` starts with frontmatter listing the ids of the documents it was written from:

```markdown
---
title: Refund policy
sources: [kb_abc123, kb_def456]
---

# Refund policy

Refunds are issued within 14 days of a request (kb_abc123).
```

- File names are lowercase kebab-case: `knowledge-base/wiki/refund-policy.md`. One topic per page, so a page stays short enough to read in one call.
- `sources` lists only ids that are in the manifest with `status: "ready"`, and every id listed was actually used on the page.
- Write what the documents say. When two documents disagree, state both with their ids rather than picking one.
- Link related pages with relative links: `[Billing](billing.md)`.

`SCHEMA.md` has no `sources`. It lists every page with a one-line summary, the conventions above as they apply to this knowledge base, and the date of the last compile. Keep it under about 100 lines.

## Compile

1. Read the manifest and collect the ready ids.
2. `read_file` `knowledge-base/wiki/SCHEMA.md`. If it is missing, this is the first compile: every ready document is new.
3. Find every existing page with `search_files` for the query `sources:` under the path `knowledge-base/wiki`, then for each page read its `sources`:
   - every id still ready: leave the page alone
   - some ids gone: rewrite the page from the sources that remain, plus any new document on the same topic
   - no id left: `delete_file` the page
4. A ready id that no page cites is a new document. Read it, then add its facts to the existing pages they belong on and create pages for topics nothing covers yet. Add its id to the `sources` of every page you touched.
5. Rewrite `SCHEMA.md` to match the pages now on disk.
6. Tell the user which pages were created, rewritten and deleted, in a few lines.

Use `write_file` to create or fully rewrite a page and `edit_file` for a small change. Never delete `SCHEMA.md`.

To rebuild from scratch, `delete_file` every page in `knowledge-base/wiki/`, including `SCHEMA.md`, then compile.
