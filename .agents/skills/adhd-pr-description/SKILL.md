---
name: adhd-pr-description
description: >-
  Write or rewrite GitHub PR descriptions in a scannable ADHD-friendly format:
  outcome-first lead, two-line before/after, short why-safe list, residual one-liner,
  tight test plan. Default for all Nakama PR bodies (agents and humans). Use when
  writing, improving, or rewriting a PR description, opening a PR via ce-commit-push-pr,
  or when the user mentions ADHD PR / adhd-pr-description. Prefer this shape over long
  narrative PR prose.
---

# ADHD PR description

**Default PR body format for this repo.** Reviewers should finish the description in one glance. The diff is already on GitHub — do not restate file moves.

Agents: load this skill whenever composing or rewriting a Nakama PR description (including via `ce-commit-push-pr`). Body **shape** comes from here; still gather real claims from the diff (outcome, risk, what you verified).

## Shape (required)

```markdown
## Summary

<one line: who does what → result. No jargon fog unless the change is jargon.>

**Before:** <one line — old behavior or cost>
**After:** <one line — new behavior; name the key function/path if it helps risk>

Why safe:
1. <reason>
2. <reason>
3. <reason>   <!-- 2–3 items max; drop #3 if nothing to say -->

Only re-add / follow up if <one residual risk or rollback trigger>.

## Test plan
- [x] <command already run> (<N> pass)
- [ ] <one manual check a human can do in <2 min>
```

Optional after test plan (keep if the workflow expects Compound Engineering badges):

```markdown
---

[![Compound Engineering](https://img.shields.io/badge/Built_with-Compound_Engineering-6366f1)](https://github.com/EveryInc/compound-engineering-plugin)
![HARNESS](https://img.shields.io/badge/<MODEL_SLUG>-000000)
```

## Rules

1. **Lead = outcome.** First Summary line is the new world, not "This PR removes…".
2. **Before/After = two lines.** Bold labels. No paragraph wrapping them.
3. **Why safe = numbered, ≤3.** Cap at 5 total bullets anywhere in the body; if more, keep only the decision-changing ones.
4. **One residual.** Name the case that would make you undo this. Skip if truly none.
5. **No diff tourism.** Do not list files, line counts as the story, or "also cleaned up exports" unless that *is* the risk.
6. **Test plan = runnable.** Prefer checked commands with pass counts; one unchecked manual probe.
7. **Title stays conventional.** `type(scope): imperative` — short. Body carries this shape; title does not need emoji or essays.
8. **Apply with `gh`.** Write body to a temp file; `gh pr edit <n> --body-file …` or `gh pr create --body-file …`. Never `--body "$(cat …)"`.

## Golden example

Match this density:

```markdown
## Summary

Approve an org-memory proposal → bullet goes into `MEMORY.md`. No LLM call.

**Before:** deterministic merge, then optional model rewrite of the whole file.
**After:** deterministic merge only (`applyApprovedOrgMemoryBullet`).

Why safe:
1. Dedup + supersede already live in that function
2. LLM path already failed closed to the deterministic result
3. −230 lines, same approve outcome

Only re-add an LLM rewrite if contradictory bullets start surviving approve.

## Test plan
- [x] `bun test packages/agent/src` (80 pass)
- [x] `bun test apps/server/src/services/org-memory-service.test.ts` (15 pass)
- [ ] Approve one pending proposal (pinned + recent-log) — bullet lands as before
```

## Anti-patterns

| Don't | Do |
| --- | --- |
| Multi-paragraph Summary | One outcome line + Before/After + Why safe |
| "This PR aims to…" / "In order to…" | Start with the verb or user action |
| Nested `###` under Summary | Flat `## Summary` + `## Test plan` only |
| Restating every deleted file | Residual risk only |
| Vague "tests passed" | Exact command + pass count |

## Workflow

1. Read the PR diff / commits (`gh pr view`, `git diff base...HEAD`)
2. Name: outcome, before, after, ≤3 why-safe, one residual
3. Fill the template — cut any sentence the diff already proves
4. Apply via `--body-file`
5. Reply with the PR URL (plus "say if you want the title tightened" only if useful)
