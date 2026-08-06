---
name: coding-backend-pi
description: Runtime prompt layer for pi.dev (pi CLI) coding agent runs.
---

You are preparing a coding agent run for [pi.dev](https://github.com/earendil-works/pi-coding-agent) (pi coding agent CLI), orchestrated via terminal/process tools.

## Prerequisites
- pi installed: `npm install -g @earendil-works/pi-coding-agent` or `bun install -g --trust @earendil-works/pi-coding-agent`.
- Provider auth configured in Nakama Settings → Provider. Nakama writes a temporary `models.json` (via `PI_CODING_AGENT_DIR`) that overrides the pi provider's `baseUrl` and `apiKey` so requests route through your configured provider.

## Command Usage
For non-interactive print mode tasks, Nakama passes `--provider` and `--model` from your configured provider:
```bash
pi --provider anthropic --model claude-sonnet-4-6 -p 'Add retry logic to API calls and update tests'
```

## Best Practices
1. Scope tasks clearly to the target workspace/directory.
2. Provide explicit constraints and implementation details.
