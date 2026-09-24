---
name: lean-pr-review
description: >-
  Review a GitHub PR for major issues first, then unnecessary complexity.
  Comment on someone else's PR; fix and push findings on your own PR.
  Use for a lean PR review, /lean-pr-review, /lean-review, or over-engineering
  feedback on a PR.
---

# Lean PR review

Review a GitHub PR for major issues, then over-engineering. Never mention internal frameworks,
scoring tags, or this skill by name in comments or commit messages.

## Input

PR URL or number (e.g. `https://github.com/OWNER/REPO/pull/N`).

## Mode: comment vs apply

After fetching PR metadata, compare the PR author to the authenticated user:

```bash
gh api user --jq .login
# vs PR .user.login
```

| Who authored the PR | What to do |
|---|---|
| **Me** (author login == `gh api user`) | **Apply** cuts on the PR head, commit, push. Do **not** post review comments. |
| **Someone else** | **Comment** only — post short inline review comments. Do not apply fixes unless the user explicitly asks. |

If the user explicitly says “comment only” or “apply”, that overrides the table.

## Steps

1. Fetch the PR with `gh` (REST preferred):
   - Metadata: title, body, base/head, author login, additions/deletions, changed files
   - Full diff for every changed file
   - Head SHA (needed to attach inline comments, or to verify before/after apply)
   - Decide mode (comment vs apply) from **Mode** above

2. First trace the changed behavior and its callers. Find concrete major issues:
   broken behavior, security or data exposure, data loss, or serious performance
   regressions. Report only issues supported by a clear failure scenario. Do not
   invent risks or flag style nits and minor test gaps. Fix or comment on these
   findings before any complexity findings.

3. Then review for unnecessary complexity. A single smoke / assert-based
   self-check is fine — never ask to delete it.

   Ask: what can get shorter or go away without losing behavior?

   Look for:
   - Dead code, unused flexibility, speculative features → cut
   - Hand-rolled stdlib / platform features → use the built-in
   - Abstraction with one implementation, config nobody sets, layer with one caller
   - Same logic in fewer lines
   - Tests that re-prove the same property twice (e.g. two phases inside one
     try/finally when one hang + one failure already covers the lock)

   If neither pass finds anything:
   - **Comment mode:** post “LGTM” as a review comment and return “LGTM” with the review URL in chat.
   - **Apply mode:** reply “LGTM — no major issues or lean cuts.” in chat only. Do not post on the PR.
   - Stop. Do not invent nits.

4. Draft findings privately as `file:Lline: problem, impact, and concrete fix`
   for major issues, or `file:Lline: what to cut. what replaces it.` for lean cuts.

5. **Branch on mode:**

### Comment mode (not my PR)

Rewrite each finding as a normal human review comment:
- Direct, concrete, kind
- Point at the specific code
- For major issues, describe the failure and the fix. For lean cuts, say what
  to drop / inline and why the remaining coverage is enough.
- No jargon labels (`yagni:`, `delete:`, `shrink:`), no scoring, no
  “net: -N lines”
- No corporate filler, no “have you considered…”, no praise sandwiches

Post via GitHub REST (not GraphQL when it times out):

```bash
gh api repos/OWNER/REPO/pulls/N/reviews --method POST --input review.json
```

`review.json` shape:

```json
{
  "commit_id": "<head_sha>",
  "event": "COMMENT",
  "body": "<1–2 sentence overall summary of the findings>",
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
- Prefer 1–3 inline comments. Prioritize major issues, then lean cuts. Merge
  related points onto one anchor line.
- Overall body stays short. Put the actionable detail on the lines.
- Use `event: "COMMENT"` unless the user asked for approve / request changes.
- After posting findings, return only the review URL. If neither pass finds
  anything, return “LGTM” with the review URL.

### Apply mode (my PR)

Do **not** post a GitHub review or inline comments.

1. Check out the PR head in an isolated worktree when practical: fetch
   `origin pull/N/head:pr-N` (or use the PR head branch) and work there so the
   user’s other checkout stays untouched.
2. Fix verified major issues first, then apply lean cuts as minimal code edits.
   No drive-by refactors beyond the findings.
3. Run the smallest relevant tests for the touched files.
4. Commit on the PR branch with a clear message focused on the fixes. Follow
   the user’s git commit rules.
5. Push to the PR head branch (`git push origin HEAD:<head_ref>` or
   equivalent).
6. Return a short chat summary: what changed + PR URL. No review comments on
   GitHub.

## Comment voice (comment mode only)

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

- **Comment mode:** do not apply code fixes unless the user asks.
- **Apply mode:** apply only verified major fixes and lean cuts; do not post
  review comments.
- Do not rewrite the PR description.
- Do not mention internal review frameworks, skills, or scoring in comments
  or commit messages.
- Do not flag production code that is already the minimal pattern (e.g. a
  boolean in-flight guard with try/finally).
