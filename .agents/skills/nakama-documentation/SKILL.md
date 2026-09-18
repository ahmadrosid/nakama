---
name: nakama-documentation
description: Write or update Nakama user documentation in docs/website/content/docs for admins, operators, and chat users.
---

# Nakama documentation

Write documentation for people using Nakama, not for developers.

## Rules

- Start with why the feature matters, then what it helps with, then how to use it.
- Use simple, everyday language. Explain unavoidable technical words in the same sentence.
- Prefer UI paths such as **System → Organization** over route names or file paths.
- Keep setup steps short and numbered.
- Use the exact labels shown in the product UI.
- Do not document internal services, database fields, source files, or HTTP APIs in user docs.
- Mention permissions, privacy, billing, and failure behavior when users need to know them.
- Add screenshots only when they make a step meaningfully easier to follow.

## Where to edit

- User docs live in `docs/website/content/docs/` as MDX files.
- Add a new page to `docs/website/content/docs/meta.json` so it appears in navigation.

## Before finishing

- Read the relevant code or existing docs when a UI label or behavior is uncertain.
- Run `bun x ultracite check` on changed files.
- Run `git diff --check`.
