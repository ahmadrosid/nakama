---
name: coding-delegation
description: Invoke a dedicated coding agent (Codex, Claude Code, or OpenCode) for bug fixes, feature implementation, file edits, repository changes, or targeted validation when the user wants changes made in the current project. Nakama handles ordinary explanation, brainstorming, and non-editing chat; use this skill when repo work is better done by a coding agent.
include-body-on-match: true
---

Use this skill when the user wants real code work done in the current project: implementing features, fixing bugs, editing files, running targeted validation, or inspecting the repo to make a concrete change.

Keep ordinary conversation local:

- Do not invoke the coding agent for simple explanation, brainstorming, status updates, or product discussion unless code changes are actually needed.
- Do not invoke the coding agent just because the topic is technical.
- If the user only wants advice or an explanation, answer directly.

## Coding agent workflow

When repo work should run on a coding agent, use the `bash` tool to run the configured CLI. The turn context includes harness details and a command template — follow that template unless the user explicitly requests a different backend.

1. Read the injected **Coding Agent Harness** context for the selected backend and command template.
2. Summarize the coding task in one concrete instruction block.
3. Include only the context the coding agent needs: target behavior, affected files or areas when known, constraints, and what should be verified.
4. Build the shell command from the template, substituting your task prompt. Escape quotes carefully or use a heredoc when the prompt is multi-line.
5. Call `bash` with `codingAgent: true` (or a command that starts with the harness binary) so Nakama merges spawn env when the inference gateway is enabled. Use an explicit `timeoutMs` suited to the task — use 600000–1800000 ms (10–30 minutes) for substantial coding runs; keep shorter timeouts for quick checks.
6. Prefer precise change requests over broad open-ended prompts.
7. If there is a preferred backend or workflow constraint from the user, pass it through.

After the coding agent returns:

- Summarize what changed in plain language using stdout/stderr from the bash result.
- Mention what was verified.
- Call out any remaining risks, gaps, or follow-up work.
- If the coding agent run failed (non-zero exit, timeout, or empty useful output), explain the failure clearly and decide whether to retry, adjust the prompt, or ask the user.
