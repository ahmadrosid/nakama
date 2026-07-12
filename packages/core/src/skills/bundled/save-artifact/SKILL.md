---
name: save-artifact
description: Save a persistent report, summary, code snippet, or log under artifacts/ for later access in the dashboard. Use when the user wants output kept beyond the chat session.
include-body-on-match: true
---

Use this skill to save **durable deliverables** the user may revisit later.

- Use `artifacts/{filename}` paths relative to the profile workspace (e.g. `artifacts/report.md`).
- Do **not** save soul files (`SOUL.md`, `STYLE.md`, `INSTRUCTIONS.md`), `MEMORY.md`, or knowledge-base uploads here — those have their own locations and workflows.
- This workflow is **text-only**. Images, PDFs, and other binary files are not supported here.

## When to use

- Reports, summaries, generated code snippets, logs, or structured notes the user asked to keep
- Outputs they may download or review later in the profile **Artifacts** tab

## Metadata sidecar

After writing the artifact file, write a JSON sidecar at `artifacts/{filename}.nakama-meta.json` so the dashboard shows the correct MIME type and timestamp.

Example for `artifacts/report.md`:

```json
{
  "mimeType": "text/markdown",
  "savedAt": "2026-07-12T05:13:00.000Z",
  "sizeBytes": 1234
}
```

- `mimeType`: choose an accurate type (`text/markdown`, `text/plain`, `application/json`, `text/html`, etc.)
- `savedAt`: current time in ISO 8601 UTC
- `sizeBytes`: UTF-8 byte length of the artifact file content (not the sidecar)

## Workflow

1. Choose a short, descriptive filename under `artifacts/` (use subdirectories when grouping related files, e.g. `artifacts/weekly/report.md`).
2. `write_file` the artifact content to `artifacts/{filename}`.
3. `write_file` the metadata sidecar to `artifacts/{filename}.nakama-meta.json` with the JSON shape above.
4. Confirm both paths in your reply so the user knows where to find the file.

## MIME type guidance

| Content | mimeType |
|---------|----------|
| Markdown | `text/markdown` |
| Plain text / logs | `text/plain` |
| JSON | `application/json` |
| HTML | `text/html` |
| Source code | `text/plain` or a specific `text/x-*` when obvious |
