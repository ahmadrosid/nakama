<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Nakama user docs

User-facing docs: `docs/website/content/docs/` (MDX). Audience = org admins, operators, chat users — not contributors.

When writing docs: **Why** → **Value** → **How** (UI paths, roles, screenshots). Prefer **System → Organization** over route paths. Keep schema, services, file paths, and HTTP API tables out of product docs (put them in the code maps or in code). Screenshots: `docs/website/public/screenshots/`; capture scripts: `docs/website/scripts/capture-*.sh`.
