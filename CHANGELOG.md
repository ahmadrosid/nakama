# Changelog

All notable changes to nakama are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries marked *(in review)* come from a pull request that is open but not merged.

## [Unreleased]

## [0.4.6] - 2026-08-28

### Added

- Discord accepts inbound image attachments for agent chat ([#659])
- Error-tracking DSN can be set from Integrations ([#444])

### Changed

- Custom tool handlers run in an allowlisted subprocess ([#653])
- Settings asks before removing an LLM provider ([#632])
- Channel worker logs redact secrets ([#639])
- Composer stack hit targets and motion tightened ([#654])
- Ponytail audit: trim dead weight ([#709])
- Low-value tests removed ([#715])

### Fixed

- Spawn env no longer forwards shell-hijacking keys ([#708])
- OAuth callback base stays on the configured public URL ([#712])
- WhatsApp outbound send requires a shared token ([#710])
- Workers list profiles only inside the request org ([#711])
- Malformed optional JSON is rejected ([#700])
- Custom file writes keep the requested mode ([#668])
- Reserved IPv6 addresses are blocked from web fetches ([#676])
- Org archive stamps `updated_at` ([#674])
- Org memory tolerates malformed history entries ([#677])
- CLI clipboard images detect type, reject oversized pastes, and restore stdin ([#649], [#642])
- CLI chat exit no longer hangs on abort polling ([#648])
- Discord inbound images cap size and infer mime ([#661])

## [0.4.5] - 2026-08-26

### Added

- OpenAI-compatible providers can use the Responses API ([#638])

### Changed

- Super Bot deletes files with `bash`; `delete_file` is no longer assigned ([#650])
- Dashboard uses Inter Variable

### Fixed

- Agent-browser install stream stays closed after it ends ([#637])
- WhatsApp reconnects once after a 408 instead of stacking sockets ([#636])

## [0.4.4] - 2026-08-26

### Added

- Export and import a single profile pack as a zip ([#475])
- WhatsApp can send artifact share links and documents ([#473])
- CSV and TSV artifacts open as spreadsheet tables ([#468])
- Batch-add provider models from setup ([#465])
- Optional error delivery to a Sentry-compatible DSN ([#442], [#443])
- Custom tool failures retry at most twice with backoff ([#454])
- Super Bot `update_profile` can edit soul files

### Changed

- Ponytail audit: shrink providers and drop unused deps ([#467])
- WhatsApp auth-state reduced after review ([#471])
- `AgentChannel` derived from a single `AGENT_CHANNELS` array ([#463])
- Asserts reviewed and low-value tests removed ([#455], [#458])

### Fixed

- Chat turns can run for 24 hours instead of timing out early ([#462])
- MCP server creation returns 4xx and is not persisted when the initial connect fails ([#633])
- WhatsApp init query timeouts no longer fail startup ([#476])
- WhatsApp auth state files use tighter permissions ([#460])
- WhatsApp stays silent when the account is not linked ([#459])
- Chat model picker stays scoped to the current session ([#466])
- Provider and timezone settings no longer answer with a TypeError ([#457])
- Creating an automation no longer answers with a raw TypeError ([#451])
- Internal automation run requires an org-scoped id ([#438])
- Database file and directory are created private ([#452])

## [0.4.3] - 2026-08-23

### Added

- WhatsApp group chats, extra allowed numbers, and quoted group context in the agent turn ([#450])
- Super Bot confirm-first `update_profile` for stored system prompts ([#450])
- Optional LLM skill curator consolidate ([#437])

### Changed

- GitHub issue forms for bug, enhancement, and new feature ([#446])

### Fixed

- Image-parsing errors link to Vision settings ([#436])
- WhatsApp phone parsing stays in the web bundle ([#450])

## [0.4.2] - 2026-08-22

### Fixed

- OpenAI model picks (including GPT-5.6 Luna) stay on OpenAI instead of falling through to OpenCode Zen ([#431])

### Changed

- CLI: drop unreachable prompt stack and dead screen buffer ([#432])

## [0.4.1] - 2026-08-22

### Added

- Optional CloakBrowser stealth Chromium behind the agent-browser skill ([#314])
- Direct MiniMax, xAI Grok, and Zhipu GLM providers with dynamic model discovery ([#392], [#408], [#394])
- Custom Python tools, including Super Bot authoring ([#352], [#403])
- Read another profile's sessions from within the same org ([#351])
- Platform admins can archive an organization ([#393])
- Composio: connect, auto-assign, and a shorter app list on Integrations ([#337])
- Knip unused-code CI gate on pull requests ([#336])

### Changed

- Tool-output pruning scales with the model context window ([#350])
- Mermaid renderer lazy-loaded ([#347])
- Add and assign MCP share one dialog ([#343])
- `@composio/core` bumped to 0.17.0 ([#426])
- Composio docs rewritten for a first-time reader ([#335])
- Asserts reviewed and low-value tests removed ([#323], [#325], [#348], [#349])
- Core channel config, heartbeat, and `web_fetch` SSRF helpers shared and shrunk ([#416], [#417], [#418], [#419])
- ADHD PR description skill set as the default body format ([#411])

### Fixed

- Drop the unawaited session delete that can end the process ([#328])
- Kill a SIGTERM-proof harness after the version probe times out ([#339])
- Bound the agent-browser version probe and SIGKILL probes that trap SIGTERM ([#330], [#424])
- Anthropic replays the streamed tool input instead of an empty object ([#345])
- OpenAI replays assistant text once when the turn also calls a tool ([#344])
- Discovery-provider helpers no longer pull in node-only modules ([#395])
- Live OpenRouter stealth models stay visible ([#404])
- Model catalog shows after an API key instead of a blank row ([#409])
- Platform admin required to rotate the local auth token ([#400])
- All browser sessions revoked on password change ([#402])
- Viewers blocked from session mutations and paid provider routes ([#401])
- Docs: local dev dashboard URL points to port 3003 ([#334])

## [0.4.0] - 2026-08-20

### Added

- Cloudflare Workers AI as an LLM provider option ([#312])
- Optional harness-native vendor login for coding agents ([#311])
- Group nested artifacts into folders ([#320])
- Skill curator: archive profile skills unused for 90 days, opt-in per org, with dry run, Run now, and a 7 day scheduled tick ([#274])
- Table of contents above long markdown artifacts, built from the h1 to h3 headings ([#298])
- Markdown artifacts can be edited by hand from the artifact panel, and saving refreshes the public share snapshot ([#299])
- `/learn` skill that distills a reusable skill from a source ([#284])
- Install a public GitHub `SKILL.md` onto a profile ([#280])
- Clone a profile ([#281])
- Cmd+K palette that jumps to any page the sidebar offers ([#279])
- Automation run results delivered to Discord ([#273])
- Rerun an automation from the run history list, with clearer failed run states
- Abort handling in `readStreamEvents`
- Narrow viewports now say the console needs a wider window ([#269])
- Docs: pages for artifacts, automations, image generation, and the token optimiser ([#303])
- Docs: private access to a self-hosted instance over Tailscale ([#290])
- `CHANGELOG.md`, covering every tagged release ([#301])

### Changed

- Pinned tool-output optimiser bumped to 0.7.5, with both pins guarded ([#263])
- Route pages lazy-loaded ([#310])
- Asserts reviewed across the codebase: dead ones removed, contract asserts added ([#266], [#286], [#295])
- Eight unused CSS rules dropped from `index.css` ([#267])
- Automation detail panel and its components cleaned up
- Low-value tests removed ([#282], [#283])
- Discord concurrency test waits for turns instead of sleeping a fixed 20ms ([#260])
- Docs: local web dashboard URL points to port 3003 ([#306]), and contributing notes now say to claim an issue before building it ([#313])

### Fixed

- Persist the Cloudflare account ID in `config.ini` ([#318])
- Use the official Cloudflare Llama 3.1 8B model ids ([#319])
- Require an admin for workspace-global settings writes ([#305])
- Require `orgId` on by-id session operations ([#321])
- Keep chat mounted when the session URL updates ([#317])
- Skill name lookups scoped to the owning org, so the first org to install a public skill no longer takes that name from every other tenant ([#288])
- Install-wide tool and MCP name uniqueness restored ([#291])
- Gemini tool schemas sanitized where `exclusiveMinimum` is rejected ([#293])
- Light-mode primary and muted-foreground raised to AA contrast ([#285])
- Text floor raised to 11px and unreadable muted text dropped ([#276])
- Console shows on tablet-width viewports ([#272])
- A SIGTERM-proof child no longer outlives its timeout ([#275])
- Coding-agent run logs pruned to the newest 10 ([#270])
- Coding agent version probe bounded by a timeout ([#268])
- Long automation fetches survive Bun idle timeouts ([#265])
- Telegram and WhatsApp stop the typing indicator once the agent finishes ([#258])
- MDX no longer parses documentation heading IDs as JSX


## [0.3.15] - 2026-08-14

### Added

- Markdown (`.md`) chat attachments
- Toggle between rendered and source view in the artifact preview ([#252])

### Changed

- Asserts reviewed: meaningless ones removed, meaningful ones added ([#257])
- Investor deck made readable and specific

### Fixed

- Channel SSE streams stay alive through long agent turns ([#256])
- Chat SSE stays open through long tool runs

## [0.3.14] - 2026-08-13

### Added

- Token optimiser ships inside the Docker image, and is fetched on demand when missing ([#250])

### Fixed

- `generate_image` previews render instead of broken thumbnails ([#251])

## [0.3.13] - 2026-08-13

### Added

- Optional tool-output optimiser with a savings panel ([#245])
- Firecrawl preinstalled as a keyless MCP server ([#248])
- Env-gated first-boot seed so managed instances skip the setup wizard ([#238])

### Changed

- CI runs the web, db and client suites ([#244])

### Fixed

- `web_fetch` content capped so one call cannot flood the context ([#242])

## [0.3.12] - 2026-08-12

### Added

- Image generation tool UI built on the AICSS image generation component ([#225])

### Fixed

- A hung provider no longer holds a session for 30 minutes ([#241])
- MCP tool parameters ordered deterministically ([#240])
- Queued typing sends stop refreshing Discord after a stop ([#239])
- Artifact share publish made usable ([#232], [#220])
- Session handling on provider timeouts and cancellations

## [0.3.11] - 2026-08-10

### Added

- List and grid toggle on the Files page ([#212])
- Admin `/allow` slash command for Discord allowed users
- Contributing guide ([#218])

### Changed

- Knowledge base management moved to the Files page ([#229])
- Icons migrated to hugeicons-react

### Fixed

- Session turn released when the client cancels a stream ([#236])
- Artifacts infinite query type inference restored ([#235])
- DeepSeek `reasoning_content` round-tripped on tool turns ([#230])
- Post-turn skill review allowed on Discord and other interactive channels ([#224])
- Shared markdown scrollable and full width on the public artifact share page
- Path segments preserved in the public web URL and the provider base URL

## [0.3.10] - 2026-08-09

### Added

- Files page for profile artifacts, with its own navigation entry (renamed from the Artifacts tab)
- Skeleton placeholders while the Files page loads

### Changed

- Lucide icons replaced with Hugeicons across chat, profiles, Telegram and Integrations

## [0.3.9] - 2026-08-09

### Added

- Image generation: `gpt-image-2` client, settings allowlist and generate route, artifact and attachment persistence, usage recorded through the token pricing bridge, and a settings card
- `send_discord_artifact`, so the agent can attach files on Discord
- Search in the Tools tab
- Model selection and thinking effort in the task run history panel

### Changed

- Automation and task pages unified
- Navigation uses icons directly in `NavItem`

### Fixed

- Discord: natural send-pdf phrasing matched, existing profile artifacts attached, Attach Files granted in the bot invite, channel profile inherited by new threads, and bot-owned threads stay responsive after a save or lock failure
- Agent tab spacing and page header alignment

## [0.3.8] - 2026-08-07

### Added

- Discord guild conversations routed into threads, with a `/close` command, questionnaire rendering and replies ([#183]), early acknowledgment ([#185]), and auto-upload of small artifacts on turn delivery ([#184])
- Cursor Agent CLI as a coding backend ([#179])

### Changed

- Coding agents integrations UI removed ([#178])
- Settings, tools, chats and integration UI tightened

### Fixed

- Discord thread ownership deletes serialized with creates, and foreign threads claimed on mention or reply
- Discord sessions shown on the history page ([#182])
- Browse discovery uses the saved base URL when editing a provider ([#181])
- Clearing worker logs asks for confirmation first

## [0.3.7] - 2026-08-07

### Changed

- Composio per-action tool injection replaced with two flat tools, `composio__search_actions` and `composio__invoke_action`, cutting per-turn token overhead regardless of toolkit size ([#176])

### Fixed

- Missing or invalid API keys surface an actionable model discovery error instead of a raw HTTP or class-name error ([#177])

## [0.3.6] - 2026-08-06

### Changed

- Logo assets reworked and the demo image refreshed

## [0.3.5] - 2026-08-06

### Added

- Data portability: export and import from settings, plus backup import in the setup wizard
- External model catalog fetched over the API
- Excel attachments accepted in chat
- hashvatar profile avatars

### Changed

- Document parsing migrated to anydoc
- Chat document attachments treated as untrusted
- Settings, Composio, integrations, notification destinations, Discord settings, artifacts and profile components reworked for layout and accessibility
- Docker build and run scripts consolidated, and the reset script renamed to destroy
- `@composio/core` upgraded to 0.14.1

### Fixed

- `reasoning_effort` forced to none for gpt-5.4 and newer when tools are present, and those tool calls routed through the Responses API
- Backup import preview request storm stopped
- Data restore rollback and the hot-reload contract hardened
- Path validation error message in `read_file`
- Derived-state sync dropped in the RAF coalesce hook

## [0.3.4] - 2026-08-05

### Added

- `skill_manage` gains edit, `write_file` and `remove_file`, with staged proposals and disk helpers
- Rainbow rim glow on the chat message and input components

### Fixed

- Skill supporting-file writes hardened

## [0.3.3] - 2026-08-04

### Added

- Post-turn skill review: opt-in per org and profile, a structured LLM reviewer, scheduling after successful turns, and suggestions shown in chat with Apply
- Thinking effort control in the chat composer
- pi.dev as a supported coding harness
- Chat message list virtualized with Virtuoso
- Theme selection in the sidebar user menu

### Fixed

- Email tools emit an OpenAI-compatible object tool schema and tolerate cross-action fields from the flat LLM schema
- Chat list session reset via key remount
- Virtuoso chat scroll and turn keys hardened

## [0.3.2] - 2026-08-03

### Changed

- Super Bot capabilities and documentation updated
- Chat message queue panel reworked

## [0.3.1] - 2026-08-03

### Fixed

- Missing `./skills/write` export added to `@nakama/core`, which 0.3.0 needed

## [0.3.0] - 2026-08-03

### Added

- Skills: a `skill_manage` tool with create, patch and delete plus guards, raw write and patch helpers, per-profile write approval, proposal management, a skill detail page, usage tracking, and a soft crystallization nudge
- Video artifacts in the attachment panel, in sharing, and on public artifact pages
- Context usage tracking in chat
- Elapsed time shown while a turn runs

### Changed

- Attachment handling streamlined, and the attachment panel made responsive on tablet widths
- Stream timeout configuration refactored
- Telegram documentation updated

## [0.2.2] - 2026-07-31

### Fixed

- Email attachment reference extraction and PDF text handling
- Org memory history and profile resolution

## [0.2.1] - 2026-07-31

### Added

- Text extracted from PDF attachments on email

### Changed

- Document text references generalized

### Fixed

- Attachment extraction boundaries tightened

## [0.2.0] - 2026-07-31

### Added

- Org memory change history with undo, a revisions endpoint, and proposal management
- Notifications page
- Organization member invites

### Changed

- Coding agent services streamlined and deprecated components removed
- API reference dropped from the documentation

## [0.1.9] - 2026-07-30

### Added

- Session stream management and status retrieval
- Session turn snapshot indexing
- Todo panel animations and expandable entries

### Changed

- Active chat profile management and navigation improved

### Fixed

- MCP tool naming and its documentation clarified

## [0.1.8] - 2026-07-30

### Added

- Org memory v1: storage layer, service methods, API routes, agent search and list tools, a summary injected into the agent thread, and an admin dashboard card
- Parallel tool execution
- Sub-agent activity tracking
- Streamdown table styling for chat markdown
- Security headers on every response

### Changed

- Sidebar and layout components reworked
- hono upgraded to 4.12.25 to pick up vulnerability fixes

### Fixed

- An existing Referrer-Policy header is preserved by the security middleware
- Chat composer error layout

## [0.1.7] - 2026-07-25

### Added

- Shaders

### Changed

- Homepage layout and styling reworked for responsiveness
- Screenshot capture script uses dynamic viewport heights
- Dark mode styling made consistent

## [0.1.6] - 2026-07-23

### Added

- Fireworks AI and Ollama as LLM providers
- Cassette listing endpoint and viewer, with multiple exchanges per LLM cassette

### Changed

- `coding-delegation` skill renamed to `coding-agent`
- Model browse components unified behind one query interface
- LLM provider UI simplified
- AGENTS.md and ARCHITECTURE.md simplified

## [0.1.5] - 2026-07-21

### Fixed

- Composio connections made on the web are reused on Telegram

## [0.1.4] - 2026-07-20

### Added

- Agent Browser: an opt-in skill for interactive browsing over bash, install and status endpoints, a docs page, and prerequisite notices in the skill picker
- Confirm-first profile factory from chat
- A Thinking or Working indicator while the chat waits between stream turns

### Fixed

- Setup wizard auth failure on HTTP Docker installs
- Crash when selecting a custom provider during setup
- Platform admin now required to clear Telegram, WhatsApp and Discord logs
- Navigate-during-render bugs on the login page
- Agent-browser skill matcher tightened to cut false positives
- Coding harness import path

## [0.1.3] - 2026-07-19

### Added

- Channel artifact delivery
- YouTube videos rendered when a link appears in a message

### Changed

- Provider picker handles duplicates and Zen browse
- Settings page reworked for the LLM provider, image parsing model and audio transcript model
- Sidebar tightened and the member invite flow improved

### Fixed

- Telegram share link
- Wrong validation when updating a model

## [0.1.2] - 2026-07-17

### Added

- Cerebras as an LLM provider
- Streaming artifact preview
- Artifact publishing
- Custom web search component

### Fixed

- Non-viewer role enforced on automation and task mutations, and caller-supplied `profileId` role-checked ([#107])
- Streaming panel handed off to the content artifact once the write completes
- External-link modal copied state reset on close ([#109])

## [0.1.1] - 2026-07-16

### Added

- Sub-agent capability
- Discord integration
- Composio integration
- Launch a coding agent from the nakama CLI
- HTML artifact rendering and a full artifact preview

### Changed

- Documents previewed and generated by content rather than by file extension
- WhatsApp library upgraded
- Tools simplified and more bundled skills shipped

## [0.1.0] - 2026-07-10

First tagged release. The baseline it established:

- Multi-tenant organizations with member management, email and password auth, and a setup wizard
- Multiple LLM providers with a models.dev browser, vision fallback, and extended thinking per profile
- Chat with branching, artifacts, knowledge base, and a todo panel
- Channels: Telegram, WhatsApp, and group message support
- MCP support with preinstalled servers and a tool playground
- Built-in tools: read file, write file behind a path guard, local search, `web_fetch`, SMTP email
- Skills, profile memory, and org-scoped profiles and tasks
- Automations with a scheduler, a PM2-managed worker, heartbeat status, and a log viewer
- Coding delegation with a harness setup UI
- Export and import for data portability
- Docker image published from GitHub Actions, and a VitePress documentation site

[Unreleased]: https://github.com/ahmadrosid/nakama/compare/v0.4.6...main
[0.4.6]: https://github.com/ahmadrosid/nakama/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/ahmadrosid/nakama/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/ahmadrosid/nakama/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/ahmadrosid/nakama/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/ahmadrosid/nakama/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/ahmadrosid/nakama/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/ahmadrosid/nakama/compare/v0.3.15...v0.4.0
[0.3.15]: https://github.com/ahmadrosid/nakama/compare/v0.3.14...v0.3.15
[0.3.14]: https://github.com/ahmadrosid/nakama/compare/v0.3.13...v0.3.14
[0.3.13]: https://github.com/ahmadrosid/nakama/compare/v0.3.12...v0.3.13
[0.3.12]: https://github.com/ahmadrosid/nakama/compare/v0.3.11...v0.3.12
[0.3.11]: https://github.com/ahmadrosid/nakama/compare/v0.3.10...v0.3.11
[0.3.10]: https://github.com/ahmadrosid/nakama/compare/v0.3.9...v0.3.10
[0.3.9]: https://github.com/ahmadrosid/nakama/compare/v0.3.8...v0.3.9
[0.3.8]: https://github.com/ahmadrosid/nakama/compare/v0.3.7...v0.3.8
[0.3.7]: https://github.com/ahmadrosid/nakama/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/ahmadrosid/nakama/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/ahmadrosid/nakama/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/ahmadrosid/nakama/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/ahmadrosid/nakama/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/ahmadrosid/nakama/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/ahmadrosid/nakama/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/ahmadrosid/nakama/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/ahmadrosid/nakama/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/ahmadrosid/nakama/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ahmadrosid/nakama/compare/v0.1.9...v0.2.0
[0.1.9]: https://github.com/ahmadrosid/nakama/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/ahmadrosid/nakama/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/ahmadrosid/nakama/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/ahmadrosid/nakama/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/ahmadrosid/nakama/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/ahmadrosid/nakama/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/ahmadrosid/nakama/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/ahmadrosid/nakama/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/ahmadrosid/nakama/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ahmadrosid/nakama/releases/tag/v0.1.0

[#107]: https://github.com/ahmadrosid/nakama/pull/107
[#109]: https://github.com/ahmadrosid/nakama/pull/109
[#121]: https://github.com/ahmadrosid/nakama/issues/121
[#176]: https://github.com/ahmadrosid/nakama/pull/176
[#177]: https://github.com/ahmadrosid/nakama/pull/177
[#178]: https://github.com/ahmadrosid/nakama/pull/178
[#179]: https://github.com/ahmadrosid/nakama/pull/179
[#181]: https://github.com/ahmadrosid/nakama/pull/181
[#182]: https://github.com/ahmadrosid/nakama/pull/182
[#183]: https://github.com/ahmadrosid/nakama/pull/183
[#184]: https://github.com/ahmadrosid/nakama/pull/184
[#185]: https://github.com/ahmadrosid/nakama/pull/185
[#212]: https://github.com/ahmadrosid/nakama/pull/212
[#218]: https://github.com/ahmadrosid/nakama/pull/218
[#220]: https://github.com/ahmadrosid/nakama/issues/220
[#224]: https://github.com/ahmadrosid/nakama/pull/224
[#225]: https://github.com/ahmadrosid/nakama/pull/225
[#229]: https://github.com/ahmadrosid/nakama/pull/229
[#230]: https://github.com/ahmadrosid/nakama/pull/230
[#232]: https://github.com/ahmadrosid/nakama/pull/232
[#235]: https://github.com/ahmadrosid/nakama/pull/235
[#236]: https://github.com/ahmadrosid/nakama/pull/236
[#238]: https://github.com/ahmadrosid/nakama/pull/238
[#239]: https://github.com/ahmadrosid/nakama/pull/239
[#240]: https://github.com/ahmadrosid/nakama/pull/240
[#241]: https://github.com/ahmadrosid/nakama/pull/241
[#242]: https://github.com/ahmadrosid/nakama/pull/242
[#244]: https://github.com/ahmadrosid/nakama/pull/244
[#245]: https://github.com/ahmadrosid/nakama/pull/245
[#248]: https://github.com/ahmadrosid/nakama/pull/248
[#250]: https://github.com/ahmadrosid/nakama/pull/250
[#251]: https://github.com/ahmadrosid/nakama/pull/251
[#252]: https://github.com/ahmadrosid/nakama/pull/252
[#256]: https://github.com/ahmadrosid/nakama/pull/256
[#257]: https://github.com/ahmadrosid/nakama/pull/257
[#258]: https://github.com/ahmadrosid/nakama/pull/258
[#260]: https://github.com/ahmadrosid/nakama/pull/260
[#263]: https://github.com/ahmadrosid/nakama/pull/263
[#265]: https://github.com/ahmadrosid/nakama/pull/265
[#266]: https://github.com/ahmadrosid/nakama/pull/266
[#267]: https://github.com/ahmadrosid/nakama/pull/267
[#268]: https://github.com/ahmadrosid/nakama/pull/268
[#269]: https://github.com/ahmadrosid/nakama/pull/269
[#270]: https://github.com/ahmadrosid/nakama/pull/270
[#272]: https://github.com/ahmadrosid/nakama/pull/272
[#273]: https://github.com/ahmadrosid/nakama/pull/273
[#274]: https://github.com/ahmadrosid/nakama/pull/274
[#275]: https://github.com/ahmadrosid/nakama/pull/275
[#276]: https://github.com/ahmadrosid/nakama/pull/276
[#279]: https://github.com/ahmadrosid/nakama/pull/279
[#280]: https://github.com/ahmadrosid/nakama/pull/280
[#281]: https://github.com/ahmadrosid/nakama/pull/281
[#282]: https://github.com/ahmadrosid/nakama/pull/282
[#283]: https://github.com/ahmadrosid/nakama/pull/283
[#284]: https://github.com/ahmadrosid/nakama/pull/284
[#285]: https://github.com/ahmadrosid/nakama/pull/285
[#286]: https://github.com/ahmadrosid/nakama/pull/286
[#288]: https://github.com/ahmadrosid/nakama/pull/288
[#290]: https://github.com/ahmadrosid/nakama/pull/290
[#291]: https://github.com/ahmadrosid/nakama/pull/291
[#293]: https://github.com/ahmadrosid/nakama/pull/293
[#295]: https://github.com/ahmadrosid/nakama/pull/295
[#298]: https://github.com/ahmadrosid/nakama/pull/298
[#299]: https://github.com/ahmadrosid/nakama/pull/299
[#301]: https://github.com/ahmadrosid/nakama/pull/301
[#303]: https://github.com/ahmadrosid/nakama/pull/303
[#305]: https://github.com/ahmadrosid/nakama/pull/305
[#306]: https://github.com/ahmadrosid/nakama/pull/306
[#310]: https://github.com/ahmadrosid/nakama/pull/310
[#311]: https://github.com/ahmadrosid/nakama/pull/311
[#312]: https://github.com/ahmadrosid/nakama/pull/312
[#313]: https://github.com/ahmadrosid/nakama/pull/313
[#317]: https://github.com/ahmadrosid/nakama/pull/317
[#318]: https://github.com/ahmadrosid/nakama/pull/318
[#319]: https://github.com/ahmadrosid/nakama/pull/319
[#320]: https://github.com/ahmadrosid/nakama/pull/320
[#321]: https://github.com/ahmadrosid/nakama/pull/321
[#314]: https://github.com/ahmadrosid/nakama/pull/314
[#323]: https://github.com/ahmadrosid/nakama/pull/323
[#325]: https://github.com/ahmadrosid/nakama/pull/325
[#328]: https://github.com/ahmadrosid/nakama/pull/328
[#330]: https://github.com/ahmadrosid/nakama/pull/330
[#334]: https://github.com/ahmadrosid/nakama/pull/334
[#335]: https://github.com/ahmadrosid/nakama/pull/335
[#336]: https://github.com/ahmadrosid/nakama/pull/336
[#337]: https://github.com/ahmadrosid/nakama/pull/337
[#339]: https://github.com/ahmadrosid/nakama/pull/339
[#343]: https://github.com/ahmadrosid/nakama/pull/343
[#344]: https://github.com/ahmadrosid/nakama/pull/344
[#345]: https://github.com/ahmadrosid/nakama/pull/345
[#347]: https://github.com/ahmadrosid/nakama/pull/347
[#348]: https://github.com/ahmadrosid/nakama/pull/348
[#349]: https://github.com/ahmadrosid/nakama/pull/349
[#350]: https://github.com/ahmadrosid/nakama/pull/350
[#351]: https://github.com/ahmadrosid/nakama/pull/351
[#352]: https://github.com/ahmadrosid/nakama/pull/352
[#392]: https://github.com/ahmadrosid/nakama/pull/392
[#393]: https://github.com/ahmadrosid/nakama/pull/393
[#394]: https://github.com/ahmadrosid/nakama/pull/394
[#395]: https://github.com/ahmadrosid/nakama/pull/395
[#400]: https://github.com/ahmadrosid/nakama/pull/400
[#401]: https://github.com/ahmadrosid/nakama/pull/401
[#402]: https://github.com/ahmadrosid/nakama/pull/402
[#403]: https://github.com/ahmadrosid/nakama/pull/403
[#404]: https://github.com/ahmadrosid/nakama/pull/404
[#408]: https://github.com/ahmadrosid/nakama/pull/408
[#409]: https://github.com/ahmadrosid/nakama/pull/409
[#411]: https://github.com/ahmadrosid/nakama/pull/411
[#416]: https://github.com/ahmadrosid/nakama/pull/416
[#417]: https://github.com/ahmadrosid/nakama/pull/417
[#418]: https://github.com/ahmadrosid/nakama/pull/418
[#419]: https://github.com/ahmadrosid/nakama/pull/419
[#424]: https://github.com/ahmadrosid/nakama/pull/424
[#426]: https://github.com/ahmadrosid/nakama/pull/426
[#431]: https://github.com/ahmadrosid/nakama/pull/431
[#432]: https://github.com/ahmadrosid/nakama/pull/432
[#436]: https://github.com/ahmadrosid/nakama/pull/436
[#437]: https://github.com/ahmadrosid/nakama/pull/437
[#438]: https://github.com/ahmadrosid/nakama/pull/438
[#442]: https://github.com/ahmadrosid/nakama/pull/442
[#443]: https://github.com/ahmadrosid/nakama/pull/443
[#446]: https://github.com/ahmadrosid/nakama/pull/446
[#450]: https://github.com/ahmadrosid/nakama/pull/450
[#451]: https://github.com/ahmadrosid/nakama/pull/451
[#452]: https://github.com/ahmadrosid/nakama/pull/452
[#454]: https://github.com/ahmadrosid/nakama/pull/454
[#455]: https://github.com/ahmadrosid/nakama/pull/455
[#457]: https://github.com/ahmadrosid/nakama/pull/457
[#458]: https://github.com/ahmadrosid/nakama/pull/458
[#459]: https://github.com/ahmadrosid/nakama/pull/459
[#460]: https://github.com/ahmadrosid/nakama/pull/460
[#462]: https://github.com/ahmadrosid/nakama/pull/462
[#463]: https://github.com/ahmadrosid/nakama/pull/463
[#465]: https://github.com/ahmadrosid/nakama/pull/465
[#466]: https://github.com/ahmadrosid/nakama/pull/466
[#467]: https://github.com/ahmadrosid/nakama/pull/467
[#468]: https://github.com/ahmadrosid/nakama/pull/468
[#471]: https://github.com/ahmadrosid/nakama/pull/471
[#473]: https://github.com/ahmadrosid/nakama/pull/473
[#475]: https://github.com/ahmadrosid/nakama/pull/475
[#476]: https://github.com/ahmadrosid/nakama/pull/476
[#633]: https://github.com/ahmadrosid/nakama/pull/633
[#636]: https://github.com/ahmadrosid/nakama/pull/636
[#637]: https://github.com/ahmadrosid/nakama/pull/637
[#638]: https://github.com/ahmadrosid/nakama/pull/638
[#444]: https://github.com/ahmadrosid/nakama/pull/444
[#632]: https://github.com/ahmadrosid/nakama/pull/632
[#639]: https://github.com/ahmadrosid/nakama/pull/639
[#642]: https://github.com/ahmadrosid/nakama/pull/642
[#648]: https://github.com/ahmadrosid/nakama/pull/648
[#649]: https://github.com/ahmadrosid/nakama/pull/649
[#650]: https://github.com/ahmadrosid/nakama/pull/650
[#653]: https://github.com/ahmadrosid/nakama/pull/653
[#654]: https://github.com/ahmadrosid/nakama/pull/654
[#659]: https://github.com/ahmadrosid/nakama/pull/659
[#661]: https://github.com/ahmadrosid/nakama/pull/661
[#668]: https://github.com/ahmadrosid/nakama/pull/668
[#674]: https://github.com/ahmadrosid/nakama/pull/674
[#676]: https://github.com/ahmadrosid/nakama/pull/676
[#677]: https://github.com/ahmadrosid/nakama/pull/677
[#700]: https://github.com/ahmadrosid/nakama/pull/700
[#708]: https://github.com/ahmadrosid/nakama/pull/708
[#709]: https://github.com/ahmadrosid/nakama/pull/709
[#710]: https://github.com/ahmadrosid/nakama/pull/710
[#711]: https://github.com/ahmadrosid/nakama/pull/711
[#712]: https://github.com/ahmadrosid/nakama/pull/712
[#715]: https://github.com/ahmadrosid/nakama/pull/715
