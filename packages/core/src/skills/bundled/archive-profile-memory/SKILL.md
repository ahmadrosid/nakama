---
name: archive-profile-memory
description: Archive or clean up facts from active MEMORY.md into memory-archive/ without deleting them. Use when the user wants to forget, remove, tidy old memory, or free space for new memories.
include-body-on-match: true
---

Use this skill when the user wants to remove facts from active memory without deleting them permanently.

- Use the `update-profile-memory` skill to **add** facts to active `MEMORY.md`.
- Use profile skills for repeatable procedures — not for archiving memory.
- Archived facts live under `memory-archive/` and are **not** loaded into chat automatically. Use `search_files` or `read_file` to retrieve them later.

## MEMORY.md shape

Active memory is `MEMORY.md` in the profile workspace:

- A preamble (`# Memory Log` and `---`) must stay intact.
- Facts are bullets under dated sections: `## YYYY-MM-DD` followed by `- bullet text`.

Copy bullet text **verbatim** from `read_file` output when editing. Do not paraphrase.

## Archive file shape

Archive files live at `memory-archive/YYYY-MM.md` (year and month of the archive action, UTC).

New archive file template:

```markdown
# Archived Memory

---
```

Each archive append starts with metadata comments, then the archived sections:

```markdown
<!-- archived: 2026-07-12T10:30:00.000Z -->
<!-- reason: user asked to forget old job details -->

## 2026-06-29

- Old preference.
```

Preserve each bullet's original `## YYYY-MM-DD` section header from `MEMORY.md`.

## Workflow

1. `read_file` `MEMORY.md` and identify the exact `- bullet` lines to archive.
2. Confirm targets with the user when the request is ambiguous.
3. Choose `memory-archive/{YYYY-MM}.md` for the current month.
4. `read_file` the archive file if it exists.
5. **Append to the archive first** (reduces data-loss risk):
   - If the file does not exist, `write_file` with the template plus the append block.
   - If it exists, `edit_file` to append after the existing content (or `write_file` the full merged content).
6. `edit_file` `MEMORY.md` to remove each archived `- bullet` line.
7. Remove any `## YYYY-MM-DD` section that has no bullets left.
8. Re-read `MEMORY.md` and the archive file to verify the result.
9. If archiving was to free space for new memories, confirm `MEMORY.md` is under 4096 bytes before retrying with `update-profile-memory`.

When `edit_file` reports a missing, duplicate, or overlapping match, `read_file` again and issue a corrected edit with exact text.

## Legacy layout

If you find archives under `data/memory-archive/` instead of `memory-archive/`, use the top-level `memory-archive/` path for new writes.
