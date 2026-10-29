# #2081: Microsoft Teams connection and direct messages

Status: builder check completed with no important open questions. Viko approved implementation and local tests on 27 October 2026. Live Teams testing waits for a tenant and bot application.

## Intent and scope

An organization admin connects one Microsoft Teams bot to one Nakama agent under Agents → agent → Connections. An allowed Teams user sends a text DM and receives that agent's response in the same chat. Sessions appear in web history under the owning organization and agent.

This is the first slice of #1599. Pairing, channel mentions, commands, files, proactive notifications, and full user documentation belong to later slices. No changes to #2086 or other channel behavior.

## Decisions already supplied

- #2081 is open, stage: now, assigned to vianbas.
- Fajarhide selected `@microsoft/teams.apps` (Teams SDK v2), a public server forwarding route, a worker-local listening port, and `NAKAMA_WEB_PUBLIC_URL` for the displayed messaging endpoint.
- The new `apps/platform/teams` workspace needs the PR label `new-package`.
- Viko has no Microsoft 365 test tenant or bot application yet. Continue preparation and local tests; do not claim a real Teams DM round trip.

Sources: [issue and assignment](https://github.com/ahmadrosid/nakama/issues/2081#issuecomment-6447287747). Nakama source inspected at main `62377026b2d315ed9a148787c41a0835caa36af8`. npm reports SDK version 2.1.1 on 27 October 2026. The matching release tag v2.1.1 confirms the HTTP adapter and explicit authentication options; check the installed package during implementation too.

## Approaches

1. Server forwards to a loopback worker. This follows the maintainer's selected approach, keeps the image on one public port, and reuses channel worker lifecycle and ownership.
2. Put the Teams SDK in the main API process. This removes forwarding but does not follow the requested worker boundary.
3. Expose a separate public worker port or use SDK Socket Mode preview. These change the requested deployment model. Do not use them for this slice.

Proceed with approach 1. The existing SDK HTTP adapter interface can bridge Bun requests to the SDK's authenticated handler. This small adapter implements a required external interface; it is not a general channel framework.

## Configuration and credentials

- Store tenant ID, client ID, client secret, and allowed Entra user object IDs under the existing organization/profile channel directory. Use the existing private-file writer, path checks, atomic replacement, and channel identity claim mechanism. Restrict the first version to a single configured tenant and client-secret authentication.
- A bot identity can belong to only one owning agent. The config owner comes from the authenticated organization and the selected profile, not a body-supplied org ID.
- Validate credential shape and perform a Microsoft app-token request before saving a changed credential set. Validation failure preserves the previous config. The worker validates again before opening its listener, so an expired secret cannot start a usable connection.
- GET/save responses expose tenant ID, client ID, allowlist, status, and a secret-configured boolean. Return no secret or secret suffix. Saving without a replacement secret preserves the saved one.
- Match the current channel credential storage convention: a private config file readable by its worker. Do not give workers `NAKAMA_SECRETS_KEY`, pass secrets through the process environment/pm2 dump, or add an endpoint that returns credentials. This proposal does not claim encrypted-at-rest storage; broader channel-token encryption is tracked separately in #2043.
- Use fixed Microsoft token endpoints built from validated tenant IDs. Do not accept a token URL from the browser. Convert upstream credential errors and SDK logs into safe messages without credentials, authorization headers, or raw error response bodies.

## Public request and ownership boundary

Public endpoint: `POST /v1/channels/teams/:profileId/messages`.

1. Add a method-specific exception to the existing public-route matcher. Other methods and routes retain Nakama authentication and organization middleware.
2. Look up the profile and its owning organization from the database. Profile IDs are globally unique in the existing schema. Refuse missing, unowned, archived, or deleted owners.
3. Resolve only that owner's Teams config and live worker. The caller cannot select an org with headers, body fields, or query parameters.
4. Forward the unchanged request body and required original headers, including Authorization, to the fixed SDK path on `127.0.0.1` at the worker's recorded port. Validate the port, require a live owner-scoped worker, do not follow redirects, bound body size and forwarding time, and do not forward browser cookies or hop-by-hop headers.
5. The SDK verifies the incoming service JWT in the worker. Explicitly disable all unauthenticated/development bypass options, even if inherited environment variables request them. The server proxy does not decode a token and treat its claims as authenticated.
6. Return a safe rejection for bad requests and an unavailable response for a stopped/stale worker. Do not expose credentials or upstream diagnostics.

The worker binds only to loopback with an ephemeral port and records that port using the existing WhatsApp pattern. A stopped worker clears its listener/heartbeat state; an old saved port alone must never authorize forwarding.

## Worker and conversation behavior

- Add Teams to worker types, desired-state restoration, start/stop/status, owner enumeration, account claims, profile/org cleanup, local client identity provisioning, development/build scripts, and Docker build/copy lists.
- Construct the SDK with explicit client ID, tenant ID, secret, safe logger, and loopback HTTP adapter. Reuse heartbeat, session persistence, and conversation locking utilities.
- Process authenticated `msteams` message activities only. Require a personal conversation, the configured tenant, a non-bot sender, a usable conversation ID, nonempty text, and the sender's Entra object ID in the administrator's allowlist. Reject before creating a session or invoking the agent. Empty allowlists deny everyone. Recheck current config when processing a queued turn so a removed user loses access.
- Keep one persisted session per personal conversation within the owner-scoped session file. Every API request carries the owning org and profile; create sessions with channel `teams`. Resume after worker restart using the existing session store.
- Send text responses through the SDK to the same conversation. Separate personal conversations can make progress independently; serialize turns within one conversation.
- The SDK awaits activity handlers. Teams retries requests that take over 15 seconds, so an HTTP acknowledgment must not await LLM generation. After JWT and access checks, schedule the bounded conversation job and return promptly; keep pending activity IDs to avoid a duplicate live turn. Catch processing errors and send a safe failure reply when possible. Do not use the SDK stream after its request lifecycle ends.
- This first slice does not introduce a durable inbox or automatic replay of interrupted tool runs. A worker crash can lose an accepted pending message. Record that limit in the PR; do not claim exactly-once or crash-safe delivery.

## Dashboard and channel integration

Use the existing Connections list and settings-page patterns. Add one Teams card with tenant ID, client ID, password input for a replacement secret, allowed Entra user IDs, connection status, and worker start/stop controls.

Show the full HTTPS messaging endpoint computed from `NAKAMA_WEB_PUBLIC_URL` and the profile ID. If the public URL is absent or not HTTPS, show the required configuration and do not show a misleading usable endpoint. A saved config and a running local listener are not proof that Microsoft can reach the bot; status copy must preserve that distinction.

Add `teams` to channel parsing and exhaustive channel tables. Show saved Teams sessions in web history as read-only, like other messaging channels. Do not add Teams automation delivery, pairing, notification destinations, or file handling in this slice.

## Local validation

Write failing tests before implementation. Test behavior rather than error strings or source text.

1. Configuration: valid save, invalid credentials preserve old config, preserve an omitted secret, allowlist validation/empty deny, account-claim conflict, correct owner path, no raw secret in public responses or captured logs.
2. Settings routes: admin can configure; members/viewers cannot write or start workers; a profile from another org is refused.
3. Public proxy: POST reaches the correct owner with unchanged body and Authorization; spoofed org headers cannot reroute; stopped/stale workers and invalid ports cannot forward; malformed/oversized requests fail safely; no redirect following.
4. SDK boundary: run the real SDK with locally signed fixture JWTs and controlled discovery/JWKS/token endpoints. Valid credentials/signature/audience pass; unsigned, expired, wrong-audience and invalid-signature requests never invoke the agent. Never enable `skipAuth` to make these tests pass.
5. DM handler: only allowed personal users enter the agent; bots, wrong tenants, unlisted users, channel/group conversations, and empty messages do not. Two DMs keep separate sessions; restart resumes the saved session; late allowlist removal blocks queued work. ACK returns while a controlled agent response is pending, and repeat activity delivery does not duplicate that live turn.
6. Dashboard: existing Connections navigation shows Teams; save/start/stop use the correct profile; missing HTTPS configuration is visible; a failed credential check leaves the worker stopped and shows a safe error.
7. Run repository `check`, `check:ci`, `knip`, the full `bun run test`, affected builds, and React Doctor. Preserve tracked plugin bundles rewritten by build tools. No browser automation unless Viko asks for it.

Local signed fixtures prove the boundary exercised in tests. They do not replace tenant registration, Azure bot configuration, a public tunnel, or a real Teams DM.

## Delivery and remaining choices

After design approval, create an isolated branch `feat/2081-teams-dm` from current upstream main. Keep the already completed #2086 branch unchanged. Use existing modules for shared registrations and new Teams-specific files only where no current module can hold their role. Keep each new hand-written file below the repository size limit.

The implementer can settle exact helper names, bounded queue/body/time limits, SDK adapter details, response chunk size, and test fixture organization. Escalate an actual incompatibility with the maintainer's forwarding approach before changing that architecture.

The PR must include setup steps for a Microsoft 365 developer tenant, Entra app/client secret, Azure Bot Teams channel, personal-scope Teams manifest, public HTTPS endpoint, allowed-user object IDs, and the manual DM check. Mark the real tenant round trip as not run until a tenant is available. A green local suite is not proof of that round trip.

## References

- [Teams SDK server adapter](https://microsoft.github.io/teams-sdk/typescript/in-depth-guides/server/http-server/)
- [Teams SDK application authentication](https://microsoft.github.io/teams-sdk/typescript/essentials/app-authentication/)
- [Microsoft activity handling and the 15-second retry boundary](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/bot-basics)
