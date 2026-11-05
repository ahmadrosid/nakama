# nakama — Agent Context

Agent platform built to work with your team — not replace them. Multi-tenant monorepo; orgs are flat tenants, each profile has a **soul** (identity, style, instructions, memory).

## Strategy

Lean is the line core keeps. Judge every design, review and issue breakdown against it.

- 512 MB of RAM is the ceiling for an install. A feature that goes over it does not go in core
- Before adding to core, ask if a plugin, a skill or an MCP server can do it. If yes, build it there
- A cost every install pays (a new process, worker, poller, browser or heavy dependency) needs a measured RSS before and after in the PR
- Work that loads a whole file or archive in memory grows with the data, so state its peak
- Bug and security fixes are not blocked by this

## Rules

**Before code**
- Read [CONTRIBUTING.md](./CONTRIBUTING.md) first, mostly ["Before you start building"](./CONTRIBUTING.md#before-you-start-building). Check the shape before the diff
- An issue someone else filed: comment to request it, state your plan, and wait for direction before code or a PR. This covers AI agents. Maintainers and issue authors are exempt. An issue assigned to someone else is not yours. A PR labelled `stale` is, with `Co-authored-by` for its author

**Code**
- Prefer edit over extract; no new package/file unless an existing module cannot hold the change. CI fails a new workspace unless the PR carries the `new-package` label
- No new abstractions for a single call site
- Tests assert behavior (status, data, side effects), not prompt/description/error copy
- React UI: one self-explanatory heading/label; no subtitles or helper copy unless the user asks or misunderstanding would cause errors

**Replies**
- ADHD-shaped: lead with the action; numbered steps; no preamble/recap
- Use [ASD-STE100 Simplified Technical English](https://www.asd-ste100.org/) in every reply to the user, including progress updates. Keep code names, commands, and paths exact.
- Human voice — short, concrete, plain words, no corporate filler
- If ambiguous, give 3 options numbered — the user will reply with a number

**Process**
- PRs: ready for review by default; drafts only on explicit user request. Overrides skills.
- Browser checks only when explicitly requested (`agent-browser`); otherwise tests, type checks, builds. Do not add Playwright.

## Review checklist

Past reviews found these most often. Check them before you open a PR.

1. **Fail closed, trust nothing.** Missing org/user/row denies access. Verify client and webhook values against the source of truth. Revoke new credentials on password change and member removal.
2. **Bound it.** Each new route, stream, listener or cache has a size cap, a deadline and cleanup on cancel/timeout.
3. **Keep errors.** No catch-all status, no silent `.catch`, no silent fallback, no raw provider errors to members.
4. **Existing installs.** Old config, stale saved lists, cached redirects and revoked state still work.
5. **Reuse first.** Search the repo and SDK for a helper. When you port upstream logic, port every branch.
6. **Tests fail without the change.** Go through the real entry point, not a mock default.

## Dev

- Bun 1.4+: `bun install`, `bun run`, `bun test`
- Servers: `bun run dev:server` | `dev:web` | `cli`
- Live LLM tests: `*.llm.test.ts` with MSW cassettes — see [CONTRIBUTING.md](./CONTRIBUTING.md#llm-cassette-tests-msw)
- Format / lint: `bun x ultracite fix` | `check` | `doctor`; unused exports: `bun run knip` (CI fails on findings)

## GitHub

Use `gh` for issues, PRs, checks, reviews, releases, and any GitHub URL. Always run outside the sandbox — inside it `gh` returns `Forbidden`.

`gh issue` / `gh pr` / `--json` go through GraphQL and often time out here. Prefer REST: `gh api repos/{owner}/{repo}/issues` or `/pulls`, body in a JSON file, `POST --input`. On GraphQL timeout, retry REST once.

**PR descriptions:** use [`.agents/skills/adhd-pr-description/SKILL.md`](.agents/skills/adhd-pr-description/SKILL.md) (default body shape). GitHub fills the same shape via `.github/PULL_REQUEST_TEMPLATE.md`. Agents composing PR bodies (including `ce-commit-push-pr`) must follow that skill.

Screenshots: `gh pr edit <number> --attach <image-path>` uploads and embeds it in the PR description.

**Releases:** follow [`.agents/skills/release/SKILL.md`](.agents/skills/release/SKILL.md): bump root `package.json` to the next patch, tag `vX.Y.Z`, publish notes with a "What's new" section, then roll out to production only on request.

## Browser automation

Prefer role and text locators. Add `data-testid` only when labels collide. For PR motion video, use `.agents/skills/browser-video-proof/SKILL.md`.

## Docker

One container: API + web + platform workers. Data at `/nakama/data` (`NAKAMA_CONFIG_DIR`), dashboard on `4310`. Run and build steps: [README](./README.md). Build from source: `./scripts/docker-build-run.sh`; fresh start: `./scripts/docker-destroy.sh` first.

Runtime deps come from committed lockfiles. To change them, edit the manifest in `.docker/runtime-deps` (or `.docker/meet-deps`), run `bun install --lockfile-only --os=linux --cpu='*'`, and commit both files.

## Packages & server

- `apps/{server,web,cli}`; channel workers in `apps/platform/{telegram,whatsapp,discord,automation}`
- `packages/core` — soul, tools, skills, contracts
- `packages/agent` — chat loop, prompts, compaction
- `packages/db` — DB
- `packages/client` — API client

## Code maps

Read the map before you change that area:

| Area | Map |
|---|---|
| System prompt, soul, tools, tool execution, workspace paths | [`packages/core/AGENTS.md`](./packages/core/AGENTS.md) |
| Server routes, middleware, multi-tenancy, org context | [`apps/server/AGENTS.md`](./apps/server/AGENTS.md) |
| CLI terminal UI | [`apps/cli/AGENTS.md`](./apps/cli/AGENTS.md) |
| User docs (`docs/website`) | [`docs/website/AGENTS.md`](./docs/website/AGENTS.md) |

Don't use compound engineering skills!
