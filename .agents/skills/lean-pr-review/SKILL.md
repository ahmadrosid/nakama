---
name: lean-pr-review
description: >-
  Review a GitHub PR for major issues first, then unnecessary complexity.
  Approve the reviewed PR and open a separate fix PR for verified findings.
  Do not post review comments or wait for the author to fix issues.
  Use for a lean PR review, /lean-pr-review, /lean-review, or over-engineering
  feedback on a PR.
---

# Lean PR review

Review a GitHub PR for major issues, then over-engineering. Never mention internal frameworks,
scoring tags, or this skill by name in comments or commit messages.

## Input

PR URL or number (e.g. `https://github.com/OWNER/REPO/pull/N`).

## Default: approve and open a fix PR

“Accept” means approve, not merge. For any author, fix verified findings in a
separate PR instead of posting comments or waiting for the author.
Explicit user instructions override this default.

## Steps

1. Fetch the PR with `gh` (REST preferred):
   - Metadata: title, body, base/head, author login, additions/deletions, changed files
   - Full diff for every changed file
   - Head SHA (needed to approve the reviewed version and prepare fixes)
   - Authenticated login: `gh api user --jq .login`

2. First trace the changed behavior and its callers. Find concrete major issues:
   broken behavior, security or data exposure, data loss, or serious performance
   regressions. Report only issues supported by a clear failure scenario. Do not
   invent risks or flag style nits and minor test gaps. Fix these
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

   If neither pass finds anything, proceed to approval without inventing nits.

4. Draft findings privately as `file:Lline: problem, impact, and concrete fix`
   for major issues, or `file:Lline: what to cut. what replaces it.` for lean cuts.

5. If findings exist, prepare and open the separate fix PR below. Then
   re-fetch the original PR head SHA. If it changed, review the new changes
   and update the fixes before approving.

6. Approve the reviewed SHA for an open PR by someone else using REST:

   ```bash
   gh api repos/OWNER/REPO/pulls/N/reviews --method POST --input review.json
   ```

   Write `review.json` with `commit_id` set to the reviewed head SHA and
   `event` set to `APPROVE`. Omit `body` and `comments`.
   GitHub does not allow approving your own PR; skip approval in that case.
   Skip approval for closed or merged PRs. Report API or permission failures
   in chat; do not substitute a comment or claim approval succeeded.

7. Return the approval URL and fix PR URL with a short summary of the fixes.
   With no findings, return “LGTM” and the approval URL. Briefly state if
   approval was skipped or failed.

## Separate fix PR

1. Check out the reviewed head SHA in an isolated worktree when practical.
   Create a new branch, such as `fix/pr-N-review`, so the user's checkout
   stays untouched. Do not push fixes to the original PR branch.
2. Fix verified major issues first, then apply lean cuts as minimal edits.
   No drive-by refactors beyond the findings.
3. Run the smallest relevant tests and required checks for the touched files.
4. Commit with a clear message focused on the fixes. Follow the user's git
   commit rules. Push the new branch to a repository you can write to; use
   a fork if necessary.
5. Open one ready-for-review PR containing the fixes:
   - Original PR open: target its head branch in its head repository so the
     diff contains only the fixes, without waiting for the original to merge.
   - Original PR merged: start from the updated base branch, apply only fixes
     still needed, test, and target that base branch.
   - Original PR closed without merging: report this in chat; do not reopen
     its changes through a fix PR.
6. Link the original PR in the fix PR body. Explain the concrete failure,
   resulting behavior, and validation. Follow the repository's PR template
   and PR description skill. Do not rewrite the original PR description.
7. If permissions or GitHub branch rules prevent opening the fix PR, preserve
   the prepared changes and report the blocker in chat. Do not post findings
   on the original PR or wait for its author to implement them.

## Boundaries

- Apply only verified major fixes and lean cuts.
- Do not post issue comments, inline review comments, or request changes
  under the default workflow.
- Approval does not authorize merging either PR.
- Do not rewrite the original PR description.
- Do not mention internal review frameworks, skills, or scoring in reviews
  or commit messages.
- Do not flag production code that is already the minimal pattern (e.g. a
  boolean in-flight guard with try/finally).
- Verify approval, push, and PR creation before claiming success.
