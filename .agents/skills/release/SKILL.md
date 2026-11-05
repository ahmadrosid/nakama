---
name: release
description: >-
  Cut a Nakama release and roll it out to production: check main, bump the
  patch version, tag, publish GitHub release notes with a user-facing
  "What's new" section, wait for the Docker image, roll it out on the
  withnakama.com platform image page in BrowserOS (browseros-neo MCP), and
  validate on nakama.withnakama.com. Use when the user says /release, "create a
  release", "cut vX.Y.Z", or "release to production".
---

# Release Nakama and roll it out

Two parts. Part A makes a GitHub release and its Docker image. Part B puts that
image on the hosted platform. Do Part B only when the user asks for production.

Run every `gh` call outside the sandbox. Prefer `gh api` (REST) to `gh pr` /
`gh release view --json`, which time out here.

## Part A: GitHub release

1. **Use a clean checkout of `main`.** If the user's checkout has other work,
   make a worktree: `git worktree add ../nakama-release origin/main`. Never
   switch the branch of a checkout that has someone else's changes.
2. **Find the range.**
   ```bash
   gh api repos/ahmadrosid/nakama/releases/latest --jq .tag_name
   git log --oneline <last-tag>..origin/main
   ```
3. **Check the risk.** Read the diff for DB schema or migration changes
   (`packages/db/sql`, `packages/db/src/adapters`), auth and access changes,
   `Dockerfile` and `.docker/runtime-deps`, and old config files that must
   still load. Tell the user about any behavior change that users will notice.
4. **Check CI on the commit you will tag.** Every check must pass, including
   `build-images` and `publish`:
   ```bash
   gh api repos/ahmadrosid/nakama/commits/<sha>/check-runs \
     --jq '.check_runs[] | "\(.name): \(.conclusion // .status)"'
   ```
   If a check still runs, wait. If one fails, stop and tell the user.
5. **Bump and tag.** Next patch after the latest release. Only root
   `package.json` changes. Commit straight to `main`, as earlier releases did.
   ```bash
   sed -i '' 's/"version": "X.Y.Z"/"version": "X.Y.Z+1"/' package.json
   git commit -m "chore: release vX.Y.Z+1" package.json
   git push origin main
   git tag vX.Y.Z+1 && git push origin vX.Y.Z+1
   ```
6. **Write the notes.** The account menu item **What's new** opens
   `releases/tag/v<running version>`, so users read this page. Put a short
   section for users on top, then the generated list:
   ```markdown
   ## What's new

   ### New
   - **<Feature>.** <One plain sentence on what the user can do> (#PR).

   ### Changed — please read
   - **<Change>.** <What works differently, and who it affects> (#PR).

   ### Fixed
   - <One line> (#PR).
   ```
   Leave out a group that has no items. Leave out docs, tests and refactors.
   ```bash
   gh api repos/ahmadrosid/nakama/releases/generate-notes \
     -f tag_name=vNEW -f previous_tag_name=vOLD --jq .body >> notes.md
   gh release create vNEW --title vNEW --notes-file notes.md --latest
   ```
   Keep `notes.md` in the scratchpad, not in the repo.

## Part B: production rollout

7. **Wait for the image.** The tag push starts "Docker Publish". Check it at
   once and then every minute or two. Do not trust a watcher that says
   nothing; read the run state yourself.
   ```bash
   gh api "repos/ahmadrosid/nakama/actions/runs?branch=vNEW&per_page=5" \
     --jq '.workflow_runs[] | "\(.name) | \(.status) | \(.conclusion)"'
   ```
8. **Get the digest.** The image tag has no `v`. Check the method on the live
   version first: its digest must match the "Live" row on the page.
   ```bash
   T=$(curl -s "https://ghcr.io/token?scope=repository:ahmadrosid/nakama:pull" \
     | python3 -I -c 'import sys,json;print(json.load(sys.stdin)["token"])')
   curl -sI -H "Authorization: Bearer $T" \
     -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" \
     https://ghcr.io/v2/ahmadrosid/nakama/manifests/X.Y.Z | grep -i docker-content-digest
   ```
9. **Roll out in BrowserOS.** Load the `browseros-neo` tools, `name_session`,
   then `tabs action="new"` with `https://withnakama.com/admin/platform-image`.
   - Fill **New image reference** with
     `ghcr.io/ahmadrosid/nakama:X.Y.Z@sha256:<digest>`.
   - Click **Roll out image**. A dialog asks you to type `ROLLOUT`. Type it and
     click **Confirm rollout** only when the user asked for production in this
     conversation.
10. **Watch the rollout.** The canary (`nakama`) goes first, then the rest.
    Read the "Rollout of X.Y.Z" region: status, "N of N instances updated",
    and the Detail column. "Host operation ensure is running" and "Waiting
    for another replacement on this host" are normal. Stop and tell the user
    if a row says failed or rolled back.
11. **Validate on the canary.**
    ```bash
    curl -s https://nakama.withnakama.com/health   # "version" must be X.Y.Z
    ```
    Then in BrowserOS open `https://nakama.withnakama.com/`, open the account
    menu, and check that the footer shows `Nakama X.Y.Z` and **What's new**
    links to `releases/tag/vX.Y.Z`. Check any feature in this release that is
    visible on that page. Take a screenshot.
12. **Finish.** Wait for "Complete" and N of N updated before you report.

## Roll back

On the platform image page, each older image in **Rollout history** has a
**Revert to X.Y.Z** button. Use it only when the user asks.

## Report

Numbered list, one line each: release URL, image reference, rollout result
(N of N, failures), canary checks (pass or fail). Say what you did not check.
Keep the BrowserOS tabs open.
