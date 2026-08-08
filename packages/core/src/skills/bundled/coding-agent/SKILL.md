---
name: coding-agent
description: Invoke a dedicated coding agent (Codex, Claude Code, OpenCode, pi, or Cursor Agent) for bug fixes, feature implementation, file edits, repository changes, or targeted validation when the user wants changes made in the current project. Nakama handles ordinary explanation, brainstorming, and non-editing chat; use this skill when repo work is better done by a coding agent.
include-body-on-match: true
---

Use this skill when the user wants real code work done in the current project: implementing features, fixing bugs, editing files, running targeted validation, or inspecting the repo to make a concrete change.

Keep ordinary conversation local:

- Do not invoke the coding agent for simple explanation, brainstorming, status updates, or product discussion unless code changes are actually needed.
- Do not invoke the coding agent just because the topic is technical.
- If the user only wants advice or an explanation, answer directly.

## Prerequisites

- This profile must have the **`bash`** tool assigned.
- A coding agent CLI must be installed on the **Nakama server host** (Codex, Claude Code, OpenCode, pi, or Cursor Agent).

Install with `bash` when missing for npm-based CLIs (global installs affect the whole host — confirm with the operator on shared servers):

```bash
npm install -g @openai/codex
npm install -g @anthropic-ai/claude-code
npm install -g opencode-ai
npm install -g @earendil-works/pi-coding-agent
```

(or the equivalent `bun install -g --trust …` if npm is unavailable)

**Cursor Agent** (`agent`) cannot be auto-installed by Nakama. If it is missing, tell the user to install and authenticate Cursor Agent CLI on the host themselves, then verify with `agent --version`. Do not attempt `npm install -g` for Cursor.

If the injected **Coding Agent Harness** context lists install commands, follow those. After install, retry the coding task.

## Choosing a backend

1. Read the injected **Coding Agent Harness** context.
2. If it says **multiple** CLIs are installed, **ask the user which one to use** before running. Do not pick silently. Remember their choice for this conversation only.
3. If exactly one CLI is available (or the context includes a single command template), use that backend.
4. If none are installed, install via bash for Codex/Claude/OpenCode/pi when appropriate, or tell the user to install Cursor Agent themselves when that is the desired backend.

## Coding agent workflow

When repo work should run on a coding agent, use the `bash` tool to run the CLI:

1. Follow the injected harness context / command template for the chosen backend when present.
2. Summarize the coding task in one concrete instruction block.
3. Include only the context the coding agent needs: target behavior, affected files or areas when known, constraints, and what should be verified.
4. Build the shell command from the template (or backend guidance), substituting your task prompt. Escape quotes carefully or use a heredoc when the prompt is multi-line.
5. Call `bash` with `codingAgent: true` **and** a command that starts with the harness binary (`codex`, `claude`, `opencode`, `pi`, or `agent`) so Nakama can recognize the harness. For Codex/Claude/OpenCode/pi, Nakama may merge provider passthrough spawn env. For **Cursor Agent**, spawn env stays empty — host Cursor auth is used instead. Use an explicit `timeoutMs` suited to the task — use 600000–1800000 ms (10–30 minutes) for substantial coding runs; keep shorter timeouts for quick checks.
6. Prefer precise change requests over broad open-ended prompts.
7. If the user names a preferred backend, use that CLI.
8. For Cursor Agent: ensure the target repo exists in the profile workspace (clone if missing), set bash cwd to that repo, run `agent -p '<task>' --output-format text --yolo` with codingAgent true (argv0 must be `agent`, not `cd && agent`). Prefer text; stream-json is summarized automatically with a full log under `artifacts/coding-agent-runs/`. See backend guidance.

After the coding agent returns:

- Summarize what changed in plain language using stdout/stderr from the bash result.
- Mention what was verified.
- Call out any remaining risks, gaps, or follow-up work.
- For implementation runs (feature / fix / repo change), the coding brief should require branch + commit + push + `gh pr create` by default (see backend guidance, especially Cursor), unless the user explicitly asked for local-only work (exploration, draft, "just look", "don't push"). Confirm the PR URL before treating the task as done.
- If the coding agent run failed (non-zero exit, timeout, or empty useful output), explain the failure clearly and decide whether to retry, adjust the prompt, or ask the user.
