---
name: update-profile-memory
description: Record facts, preferences, and personal context in active MEMORY.md for cross-session continuity. Use when the user shares something to remember, states a preference, or you learn durable context about them.
include-body-on-match: true
---

Use this skill to **add** facts to active `MEMORY.md`.

- Use profile skills for repeatable procedures — not for one-off facts.
- Use `knowledge_base_search` for uploaded documents — do not dump reference content into `MEMORY.md`.
- Use the `archive-profile-memory` skill when `MEMORY.md` is full or the user wants facts removed without deleting them.

## MEMORY.md shape

Active memory is `MEMORY.md` in the profile workspace:

```markdown
# Memory Log

---
```

Facts are bullets under dated sections: `## YYYY-MM-DD` followed by `- bullet text`.

Use the user's timezone from the system prompt when choosing today's date header.

Copy existing text **verbatim** from `read_file` output when editing. Do not paraphrase.

## Size limit

`MEMORY.md` must stay at or below **4096 bytes**. Before writing, estimate the final file size. If a write would exceed the limit, follow `archive-profile-memory` to free space, then retry.

## Workflow

1. Choose the fact to record as a single concise bullet (no leading `-` in your mental draft — add it in the file).
2. `read_file` `MEMORY.md`.
3. **If the file does not exist**, `write_file` with the template above, a blank line, today's `## YYYY-MM-DD` header, and the new `- bullet`.
4. **If today's `## YYYY-MM-DD` section exists**, `edit_file` to append `- bullet` at the end of that section (before the next `##` header or end of file).
5. **If today's section does not exist**, `edit_file` to append a blank line, today's `## YYYY-MM-DD` header, a blank line, and `- bullet` at the end of the file.
6. Re-read `MEMORY.md` and confirm the bullet is present and the file is at or below 4096 bytes.

When `edit_file` reports a missing, duplicate, or overlapping match, `read_file` again and issue a corrected edit with exact text.

## Examples

Good memory bullets:

- User prefers concise answers.
- Works in Jakarta (UTC+7).
- Primary language for docs is English.

Not memory — use skills or KB instead:

- Step-by-step deploy procedure.
- Full text of an uploaded PDF.
