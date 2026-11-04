# CLI terminal UI map

Root rules: [`../../AGENTS.md`](../../AGENTS.md).

| File | Purpose |
|---|---|
| `apps/cli/src/terminal-renderer.ts` | Composer, transcript, stream, and status rules |
| `apps/cli/src/terminal-layout.ts` | Viewport, pinned input, stream buffer, frame component, and cursor |
| `apps/cli/src/virtual-message-list.ts` | Transcript wrap and spacing |

`PersistentPrompt` sends composer state to `TerminalRenderer`, which calls `buildComposerLines()`. `TerminalLayout` reserves composer rows. The transcript uses `beginMessage`, `writelnScroll`, and `endMessage`. The stream writes to `streamBuffer`. `endStream()` seals the stream.

Spacing has layers. User-bubble padding, composer padding, and inter-message gaps are different. `shouldInsertLeadingGap` adds a gap before a message. `endStream()` adds a gap after the stream.
