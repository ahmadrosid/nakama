---
name: lean-pr-review
description: >-
  Review a GitHub PR for unnecessary complexity, then post short human-sounding
  inline review comments via gh. Use when the user asks for a lean PR review,
  /lean-review, "review this PR and comment", or wants over-engineering feedback
  posted on a PR without applying fixes.
---

# Lean PR review

Review a GitHub PR for over-engineering, then post short human-sounding review
comments. Never mention internal frameworks, scoring tags, or this skill by name
in the comments.

## Input

PR URL or number (e.g. `https://github.com/OWNER/REPO/pull/N`).

## Steps

1. Fetch the PR with `gh` (REST preferred; always outside the sandbox —
   `required_permissions: ["all"]`):
   - Metadata: title, body, base/head, additions/deletions, changed files
   - Full diff for every changed file
   - Head SHA (needed to attach inline comments)

2. Review **only** for unnecessary complexity. Out of scope: correctness bugs,
   security, performance, style nits, missing tests as a quality complaint.
   A single smoke / assert-based self-check is fine — never ask to delete it.

   Ask: what can get shorter or go away without losing behavior?

   Look for:
   - Dead code, unused flexibility, speculative features → cut
   - Hand-rolled stdlib / platform features → use the built-in
   - Abstraction with one implementation, config nobody sets, layer with one caller
   - Same logic in fewer lines
   - Tests that re-prove the same property twice (e.g. two phases inside one
     try/finally when one hang + one failure already covers the lock)

   If nothing to cut: post one short approving comment like “Looks lean — ship.”
   and stop. Do not invent nits.

3. Draft findings privately as:
   `file:Lline: what to cut. what replaces it.`
   Then rewrite each finding as a normal human review comment:
   - Direct, concrete, kind
   - Point at the specific code
   - Say what to drop / inline and why the remaining coverage is enough
   - No jargon labels (`yagni:`, `delete:`, `shrink:`), no scoring, no
     “net: -N lines”
   - No corporate filler, no “have you considered…”, no praise sandwiches

4. Post via GitHub REST (not GraphQL when it times out):

```bash
gh api repos/OWNER/REPO/pulls/N/reviews --method POST --input review.json
```

`review.json` shape:

```json
{
  "commit_id": "<head_sha>",
  "event": "COMMENT",
  "body": "<1–2 sentence overall: vibe + that the core change is fine if it is>",
  "comments": [
    {
      "path": "path/to/file.ts",
      "line": 42,
      "side": "RIGHT",
      "body": "<human comment>"
    }
  ]
}
```

- Use `side: "RIGHT"` for lines in the new version of the file.
- Prefer 1–3 inline comments. Merge related points onto one anchor line.
- Overall body stays short. Put the actionable detail on the lines.
- Use `event: "COMMENT"` unless the user asked for approve / request changes.
- After posting, return only the review URL.

## Comment voice

Good:

> Reload hang + reload reject already prove admission before the first await
> and release in `finally` across the whole cycle. The curator-phase overlap /
> failure path doesn’t add much on top of that — you could drop
> `curatorStarted`, `failingCurator`, and `curatorCalls` and keep the same
> confidence with a shorter test.

Good:

> Only used once — fine to inline `1000` at `beginPolling`.

Bad:

> yagni: curator-phase overlap. Drop it.
> net: -30 lines possible.
> As per our complexity guidelines…

## Boundaries

- Do not apply code fixes unless the user asks.
- Do not rewrite the PR description.
- Do not mention internal review frameworks, skills, or scoring in comments.
- Do not flag production code that is already the minimal pattern (e.g. a
  boolean in-flight guard with try/finally).
