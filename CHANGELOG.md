# Changelog

All notable changes to nakama are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries marked *(in review)* come from a pull request that is open but not merged.

## [Unreleased]

### Added

- Skill curator: archive profile skills unused for 90 days, opt-in per org, with dry run, Run now, and a 7 day scheduled tick ([#274], in review)
- Repeated in-flight tool polls are waited out inside the tool loop, so a long MCP job costs one turn instead of one per poll ([#300], in review)
- Table of contents above long markdown artifacts, built from the h1 to h3 headings ([#298], in review)
- Markdown artifacts can be edited by hand from the artifact panel, and saving refreshes the public share snapshot ([#299], in review)
- `/learn` skill that distills a reusable skill from a source ([#284])
- Install a public GitHub `SKILL.md` onto a profile ([#280])
- Clone a profile ([#281])
- Cmd+K palette that jumps to any page the sidebar offers ([#279])
- Automation run results delivered to Discord ([#273])
- Rerun an automation from the run history list, with clearer failed run states
- Abort handling in `readStreamEvents`
- Narrow viewports now say the console needs a wider window ([#269])
- Docs: private access to a self-hosted instance over Tailscale ([#290])

### Changed

- Pinned tool-output optimiser bumped to 0.7.5, with both pins guarded ([#263])
- Asserts reviewed across the codebase: dead ones removed, contract asserts added ([#266], [#286], [#295])
- Eight unused CSS rules dropped from `index.css` ([#267])
- Automation detail panel and its components cleaned up
- Low-value tests removed ([#282], [#283])
- Discord concurrency test waits for turns instead of sleeping a fixed 20ms ([#260])

### Fixed

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

[Unreleased]: https://github.com/ahmadrosid/nakama/compare/v0.3.15...main
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
[#300]: https://github.com/ahmadrosid/nakama/pull/300
