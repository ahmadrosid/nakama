---
name: save-artifact
description: Save or move durable outputs (reports, slide decks, HTML, summaries, code snippets, logs) under artifacts/ for the dashboard Artifacts tab. Use when the user asks to save, move, or keep something as an artifact beyond the chat session.
include-body-on-match: true
---

Use this skill to save **durable deliverables** the user may revisit later.

- Use `artifacts/{filename}` paths relative to the profile workspace (e.g. `artifacts/report.md`).
- Do **not** save soul files (`SOUL.md`, `STYLE.md`, `INSTRUCTIONS.md`), `MEMORY.md`, or knowledge-base uploads here — those have their own locations and workflows.
- This workflow is **text-only**. Images, PDFs, and other binary files are not supported here.

## When to use

- Reports, summaries, generated code snippets, logs, or structured notes the user asked to keep
- Outputs they may download or review later in the profile **Artifacts** tab

## Workflow

1. Choose a short, descriptive filename with the correct extension under `artifacts/` (use subdirectories when grouping related files, e.g. `artifacts/weekly/report.md`).
2. `write_file` the artifact content to `artifacts/{filename}`. If that name already exists, a date suffix is added automatically (e.g. `report-2026-07-14.md`).
3. Confirm the saved path returned by the tool. On web chat, saved artifacts also appear as attachment chips on the assistant message (with preview) in addition to the profile **Artifacts** tab.

Save only the deliverable; Nakama derives the file type, size, and timestamp automatically.
