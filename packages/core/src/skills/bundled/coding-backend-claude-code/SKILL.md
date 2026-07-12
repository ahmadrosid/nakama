---
name: coding-backend-claude-code
description: Runtime prompt layer for Claude Code coding agent runs.
disable-model-invocation: true
include-body-on-match: true
---

You are preparing a coding agent run for [Claude Code](https://code.claude.com/docs/en/cli-reference) (Anthropic's autonomous coding agent CLI), orchestrated via terminal/process tools. Claude Code v2.x can read files, write code, run shell commands, spawn subagents, and manage git workflows autonomously.

## When to Use

- Building features
- Refactoring
- PR reviews
- Batch issue fixing
- Multi-turn iterative coding sessions

## Prerequisites

- **Install:** `npm install -g @anthropic-ai/claude-code`.
- **Auth:** run `claude` once to log in (browser OAuth for Pro/Max, or set `ANTHROPIC_API_KEY`).
- **Console auth:** `claude auth login --console` for API key billing.
- **SSO auth:** `claude auth login --sso` for Enterprise.
- **Check status:** `claude auth status` (JSON) or `claude auth status --text` (human-readable).
- **Health check:** `claude doctor` — checks auto-updater and installation health.
- **Version check:** `claude --version` (requires v2.x+).
- **Update:** `claude update` or `claude upgrade`.

## Two Orchestration Modes

### Mode 1: Print Mode (`-p`) — Non-Interactive (PREFERRED for most tasks)

Print mode runs a one-shot task, returns the result, and exits. No PTY needed. No interactive prompts. This is the cleanest integration path.

```
claude -p 'Add error handling to all API calls in src/' --allowedTools 'Read,Edit' --max-turns 10
```

Use print mode for one-shot coding tasks, CI/CD automation, structured data extraction (`--json-schema`), piped input processing, and any task where you don't need multi-turn conversation. Print mode skips ALL interactive dialogs — no workspace trust prompt, no permission confirmations.

### Mode 2: Interactive PTY via tmux — Multi-Turn Sessions

Interactive mode gives a full conversational REPL for follow-up prompts, slash commands, and real-time monitoring. Requires tmux orchestration.

```
# Start a tmux session
tmux new-session -d -s claude-work -x 140 -y 40

# Launch Claude Code inside it
tmux send-keys -t claude-work 'cd /path/to/project && claude' Enter

# Wait for startup, then send your task
sleep 5 && tmux send-keys -t claude-work 'Refactor the auth module to use JWT tokens' Enter

# Monitor progress by capturing the pane
sleep 15 && tmux capture-pane -t claude-work -p -S -50

# Send follow-up tasks
tmux send-keys -t claude-work 'Now add unit tests for the new JWT code' Enter

# Exit when done
tmux send-keys -t claude-work '/exit' Enter
```

Use interactive mode for multi-turn iterative work (refactor → review → fix → test), human-in-the-loop decisions, exploratory coding, and slash commands (`/compact`, `/review`, `/model`).

## PTY Dialog Handling (CRITICAL for Interactive Mode)

Claude Code presents up to two confirmation dialogs on first launch. Handle these via tmux send-keys:

### Dialog 1: Workspace Trust (first visit to a directory)
Default selection is "Yes, I trust this folder" — just press `Enter`.

### Dialog 2: Bypass Permissions Warning (only with `--dangerously-skip-permissions`)
Default is "No, exit" (WRONG choice). Must navigate DOWN first, then Enter:
```
tmux send-keys -t <session> Down && sleep 0.3 && tmux send-keys -t <session> Enter
```

After the first trust acceptance for a directory, the trust dialog won't appear again. Only the permissions dialog recurs each time you use `--dangerously-skip-permissions`.

## CLI Subcommands

| Subcommand | Purpose |
|------------|---------|
| `claude` | Start interactive REPL |
| `claude "query"` | Start REPL with initial prompt |
| `claude -p "query"` | Print mode (non-interactive, exits when done) |
| `cat file \| claude -p "query"` | Pipe content as stdin context |
| `claude -c` | Continue the most recent conversation in this directory |
| `claude -r "id"` | Resume a specific session by ID or name |
| `claude auth login` | Sign in (`--console` for API billing, `--sso` for Enterprise) |
| `claude auth status` | Check login status (JSON; `--text` for human-readable) |
| `claude mcp add <name> -- <cmd>` | Add an MCP server |
| `claude mcp list` | List configured MCP servers |
| `claude doctor` | Run health checks on installation and auto-updater |
| `claude update` / `claude upgrade` | Update Claude Code to latest version |

## Print Mode Deep Dive

### Structured JSON Output
```
claude -p 'Analyze auth.py for security issues' --output-format json --max-turns 5
```
Returns a JSON object with `session_id` (for resumption), `num_turns` (agentic loop count), `total_cost_usd` (spend tracking), and `subtype` (`success`, `error_max_turns`, `error_budget`).

### Streaming JSON Output
```
claude -p 'Write a summary' --output-format stream-json --verbose --include-partial-messages
```
Returns newline-delimited JSON events for real-time token streaming.

### Piped Input
```
cat src/auth.py | claude -p 'Review this code for bugs' --max-turns 1
git diff HEAD~3 | claude -p 'Summarize these changes' --max-turns 1
```

### JSON Schema for Structured Extraction
```
claude -p 'List all functions in src/' --output-format json --json-schema '{...}' --max-turns 5
```
Claude validates output against the schema before returning.

### Session Continuation
```
# Start a task
claude -p 'Start refactoring the database layer' --output-format json --max-turns 10

# Resume with session ID
claude -p 'Continue and add connection pooling' --resume <id> --max-turns 5

# Or resume the most recent session in the same directory
claude -p 'What did you do last time?' --continue --max-turns 1

# Fork a session (new ID, keeps history)
claude -p 'Try a different approach' --resume <id> --fork-session --max-turns 10
```

### Bare Mode for CI/Scripting
```
claude --bare -p 'Run all tests and report failures' --allowedTools 'Read,Bash' --max-turns 10
```
`--bare` skips hooks, plugins, MCP discovery, and CLAUDE.md loading. Fastest startup. Requires `ANTHROPIC_API_KEY` (skips OAuth).

### Fallback Model for Overload
```
claude -p 'task' --fallback-model haiku --max-turns 5
```

## Complete CLI Flags Reference

### Session & Environment
| Flag | Effect |
|------|--------|
| `-p, --print` | Non-interactive one-shot mode (exits when done) |
| `-c, --continue` | Resume most recent conversation in current directory |
| `-r, --resume <id>` | Resume specific session by ID or name |
| `--fork-session` | When resuming, create new session ID instead of reusing original |
| `--add-dir <paths...>` | Grant Claude access to additional working directories |
| `-w, --worktree [name]` | Run in an isolated git worktree at `.claude/worktrees/<name>` |
| `--tmux` | Create a tmux session for the worktree (requires `--worktree`) |
| `--from-pr [number]` | Resume session linked to a specific GitHub PR |

### Model & Performance
| Flag | Effect |
|------|--------|
| `--model <alias>` | `sonnet`, `opus`, `haiku`, or full name like `claude-sonnet-4-6` |
| `--effort <level>` | Reasoning depth: `low`, `medium`, `high`, `max`, `auto` |
| `--max-turns <n>` | Limit agentic loops (print mode only; prevents runaway) |
| `--max-budget-usd <n>` | Cap API spend in dollars (print mode only) |
| `--fallback-model <model>` | Auto-fallback when default model is overloaded (print mode only) |

### Permission & Safety
| Flag | Effect |
|------|--------|
| `--dangerously-skip-permissions` | Auto-approve ALL tool use (file writes, bash, network, etc.) |
| `--permission-mode <mode>` | `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions` |
| `--allowedTools <tools...>` | Whitelist specific tools (comma or space-separated) |
| `--disallowedTools <tools...>` | Blacklist specific tools |

### Output & Input Format
| Flag | Effect |
|------|--------|
| `--output-format <fmt>` | `text` (default), `json` (single result object), `stream-json` (newline-delimited) |
| `--input-format <fmt>` | `text` (default) or `stream-json` (real-time streaming input) |
| `--json-schema <schema>` | Force structured JSON output matching a schema |
| `--verbose` | Full turn-by-turn output |
| `--include-partial-messages` | Include partial message chunks as they arrive (stream-json + print) |

### System Prompt & Context
| Flag | Effect |
|------|--------|
| `--append-system-prompt <text>` | Add to the default system prompt (preserves built-in capabilities) |
| `--append-system-prompt-file <path>` | Add file contents to the default system prompt |
| `--system-prompt <text>` | Replace the entire system prompt |
| `--bare` | Skip hooks, plugins, MCP discovery, CLAUDE.md, OAuth (fastest startup) |
| `--mcp-config <path>` | Load MCP servers from JSON file (repeatable) |
| `--strict-mcp-config` | Only use MCP servers from `--mcp-config`, ignoring all other MCP configs |
| `--settings <file-or-json>` | Load additional settings from a JSON file or inline JSON |

### Tool Name Syntax for --allowedTools / --disallowedTools
```
Read                    # All file reading
Edit                    # File editing (existing files)
Write                   # File creation (new files)
Bash                    # All shell commands
Bash(git *)             # Only git commands
Bash(git commit *)      # Only git commit commands
Bash(npm run lint:*)    # Pattern matching with wildcards
WebSearch               # Web search capability
WebFetch                # Web page fetching
mcp__<server>__<tool>   # Specific MCP tool
```

## Settings & Configuration

### Settings Hierarchy (highest to lowest priority)
1. **CLI flags** — override everything
2. **Local project:** `.claude/settings.local.json` (personal, gitignored)
3. **Project:** `.claude/settings.json` (shared, git-tracked)
4. **User:** `~/.claude/settings.json` (global)

### Memory Files (CLAUDE.md) Hierarchy
1. **Global:** `~/.claude/CLAUDE.md` — applies to all projects
2. **Project:** `./CLAUDE.md` — project-specific context (git-tracked)
3. **Local:** `.claude/CLAUDE.local.md` — personal project overrides (gitignored)

Use the `#` prefix in interactive mode to quickly add to memory: `# Always use 2-space indentation`.

## Interactive Session: Slash Commands

### Session & Context
| Command | Purpose |
|---------|---------|
| `/help` | Show all commands (including custom and MCP commands) |
| `/compact [focus]` | Compress context to save tokens; CLAUDE.md survives compaction |
| `/clear` | Wipe conversation history for a fresh start |
| `/context` | Visualize context usage as a colored grid with optimization tips |
| `/cost` | View token usage with per-model and cache-hit breakdowns |
| `/resume` | Switch to or resume a different session |
| `/rewind` | Revert to a previous checkpoint in conversation or code |
| `/exit` or `Ctrl+D` | End session |

### Development & Review
| Command | Purpose |
|---------|---------|
| `/review` | Request code review of current changes |
| `/security-review` | Perform security analysis of current changes |
| `/plan [description]` | Enter Plan mode with auto-start for task planning |
| `/loop [interval]` | Schedule recurring tasks within the session |
| `/batch` | Auto-create worktrees for large parallel changes (5-30 worktrees) |

### Configuration & Tools
| Command | Purpose |
|---------|---------|
| `/model [model]` | Switch models mid-session (arrow keys adjust effort) |
| `/effort [level]` | Set reasoning effort: `low`, `medium`, `high`, `max`, `auto` |
| `/init` | Create a CLAUDE.md file for project memory |
| `/memory` | Open CLAUDE.md for editing |
| `/permissions` | View/update tool permissions |
| `/agents` | Manage specialized subagents |
| `/mcp` | Interactive UI to manage MCP servers |
| `/add-dir` | Add additional working directories (useful for monorepos) |

## Interactive Session: Keyboard Shortcuts

### General Controls
| Key | Action |
|-----|--------|
| `Ctrl+C` | Cancel current input or generation |
| `Ctrl+D` | Exit session |
| `Ctrl+R` | Reverse search command history |
| `Ctrl+B` | Background a running task |
| `Ctrl+V` | Paste image into conversation |
| `Ctrl+O` | Transcript mode — see Claude's thinking process |
| `Esc Esc` | Rewind conversation or code state / summarize |

### Mode Toggles
| Key | Action |
|-----|--------|
| `Shift+Tab` | Cycle permission modes (Normal → Auto-Accept → Plan) |
| `Alt+P` | Switch model |
| `Alt+T` | Toggle thinking mode |
| `Alt+O` | Toggle Fast Mode |

### Input Prefixes
| Prefix | Action |
|--------|--------|
| `!` | Execute bash directly, bypassing AI (e.g., `!npm test`) |
| `@` | Reference files/directories with autocomplete (e.g., `@./src/api/`) |
| `#` | Quick add to CLAUDE.md memory (e.g., `# Use 2-space indentation`) |
| `/` | Slash commands |

### Pro Tip: "ultrathink"
Use the keyword "ultrathink" in your prompt for maximum reasoning effort on a specific turn, regardless of the current `/effort` setting.

## PR Review Pattern

### Quick Review (Print Mode)
```
cd /path/to/repo && git diff main...feature-branch | claude -p 'Review this diff for bugs, security issues, and style problems. Be thorough.' --max-turns 1
```

### Deep Review (Interactive + Worktree)
```
tmux new-session -d -s review -x 140 -y 40
tmux send-keys -t review 'cd /path/to/repo && claude -w pr-review' Enter
sleep 5 && tmux send-keys -t review Enter   # Trust dialog
sleep 2 && tmux send-keys -t review 'Review all changes vs main. Check for bugs, security issues, race conditions, and missing tests.' Enter
sleep 30 && tmux capture-pane -t review -p -S -60
```

### PR Review from Number
```
claude -p 'Review this PR thoroughly' --from-pr 42 --max-turns 10
```

## Parallel Claude Instances

Run multiple independent Claude tasks simultaneously in separate tmux sessions:

```
# Task 1: Fix backend
tmux new-session -d -s task1 -x 140 -y 40 && tmux send-keys -t task1 'cd ~/project && claude -p "Fix the auth bug in src/auth.py" --allowedTools "Read,Edit" --max-turns 10' Enter

# Task 2: Write tests
tmux new-session -d -s task2 -x 140 -y 40 && tmux send-keys -t task2 'cd ~/project && claude -p "Write integration tests for the API endpoints" --allowedTools "Read,Write,Bash" --max-turns 15' Enter

# Task 3: Update docs
tmux new-session -d -s task3 -x 140 -y 40 && tmux send-keys -t task3 'cd ~/project && claude -p "Update README.md with the new API endpoints" --allowedTools "Read,Edit" --max-turns 5' Enter

# Monitor all
sleep 30 && for s in task1 task2 task3; do echo '=== '$s' ==='; tmux capture-pane -t $s -p -S -5 2>/dev/null; done
```

## Monitoring Interactive Sessions

Look for these indicators in `tmux capture-pane` output:
- `❯` at bottom = waiting for your input (Claude is done or asking a question)
- `●` lines = Claude is actively using tools (reading, writing, running commands)
- `⏵⏵ bypass permissions on` = status bar showing permissions mode
- `◐ medium · /effort` = current effort level in status bar

### Context Window Health
Use `/context` in interactive mode to see a colored grid of context usage:
- **< 70%** — Normal operation, full precision
- **70-85%** — Precision starts dropping, consider `/compact`
- **> 85%** — Hallucination risk spikes significantly, use `/compact` or `/clear`

## Environment Variables

| Variable | Effect |
|----------|--------|
| `ANTHROPIC_API_KEY` | API key for authentication (alternative to OAuth) |
| `CLAUDE_CODE_EFFORT_LEVEL` | Default effort: `low`, `medium`, `high`, `max`, `auto` |
| `MAX_THINKING_TOKENS` | Cap thinking tokens (set to `0` to disable thinking entirely) |
| `MAX_MCP_OUTPUT_TOKENS` | Cap output from MCP servers (e.g., `50000`) |

## Cost & Performance Tips

1. Use `--max-turns` in print mode to prevent runaway loops. Start with 5-10 for most tasks.
2. Use `--max-budget-usd` for cost caps (minimum ~$0.05 for system prompt cache creation).
3. Use `--effort low` for simple tasks (faster, cheaper); `high` or `max` for complex reasoning.
4. Use `--bare` for CI/scripting to skip plugin/hook discovery overhead.
5. Use `--allowedTools` to restrict to only what's needed (e.g., `Read` only for reviews).
6. Use `/compact` in interactive sessions when context gets large.
7. Pipe input instead of having Claude read files when you just need analysis of known content.
8. Use `--model haiku` for simple tasks (cheaper) and `--model opus` for complex multi-step work.
9. Use `--fallback-model haiku` in print mode to gracefully handle model overload.
10. Start new sessions for distinct tasks — sessions last 5 hours; fresh context is more efficient.

## Pitfalls & Gotchas

1. **Interactive mode REQUIRES tmux** — Claude Code is a full TUI app. `pty=true` alone works but tmux gives `capture-pane` for monitoring and `send-keys` for input.
2. **`--dangerously-skip-permissions` dialog defaults to "No, exit"** — send Down then Enter to accept. Print mode (`-p`) skips this entirely.
3. **`--max-budget-usd` minimum is ~$0.05** — system prompt cache creation alone costs this much.
4. **`--max-turns` is print-mode only** — ignored in interactive sessions.
5. **Session resumption requires same directory** — `--continue` finds the most recent session for the current working directory.
6. **Trust dialog only appears once per directory** — first-time only, then cached.
7. **Background tmux sessions persist** — always clean up with `tmux kill-session -t <name>` when done.
8. **Slash commands only work in interactive mode** — in `-p` mode, describe the task in natural language.
9. **`--bare` skips OAuth** — requires `ANTHROPIC_API_KEY` env var or an `apiKeyHelper` in settings.
10. **Context degradation is real** — output quality degrades above 70% context window usage. Monitor with `/context` and proactively `/compact`.

## Rules

1. **Prefer print mode (`-p`) for single tasks** — cleaner, no dialog handling, structured output.
2. **Use tmux for multi-turn interactive work** — the only reliable way to orchestrate the TUI.
3. **Always set `workdir`** — keep Claude focused on the right project directory.
4. **Set `--max-turns` in print mode** — prevents infinite loops and runaway costs.
5. **Monitor tmux sessions** — use `tmux capture-pane -t <session> -p -S -50` to check progress.
6. **Look for the `❯` prompt** — indicates Claude is waiting for input (done or asking a question).
7. **Clean up tmux sessions** — kill them when done to avoid resource leaks.
8. **Report results to user** — after completion, summarize what Claude did and what changed.
9. **Don't kill slow sessions** — Claude may be doing multi-step work; check progress instead.
10. **Use `--allowedTools`** — restrict capabilities to what the task actually needs.

## Prompt Preparation Checklist

When preparing the coding agent instruction for Claude Code:

- Give Claude Code a clear implementation goal plus any important constraints.
- Ask it to inspect the relevant code paths before editing.
- Encourage small, direct edits rather than broad rewrites unless the task requires them.
- Ask for concise validation notes and a short explanation of any unresolved issues.
- Prefer precise change requests over broad open-ended prompts.
