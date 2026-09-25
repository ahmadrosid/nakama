import {
  formatPendingDisplayLines,
  type PendingMessage,
} from "./message-queue";
import { normalizePastedText, splitInputDisplayLines } from "./prompt-display";
import {
  cloneStyledLine,
  plainLine,
  type StyledLine,
  styledLine,
} from "./styled-text";
import type { TerminalInput } from "./terminal-input";
import { getTerminalColumns, TerminalLayout } from "./terminal-layout";
import { truncateText, visibleLength } from "./text-measure";

export interface ComposerSuggestion {
  description: string;
  label: string;
}

export interface ComposerState {
  cursorVisible: boolean;
  imageCount?: number;
  prefix: string;
  selectedIndex: number;
  suggestions: ComposerSuggestion[];
  value: string;
}

export interface UserMessageOptions {
  placement?: "scroll" | "below_status";
  prefix?: string;
}

export interface TerminalRendererState {
  composer: ComposerState;
  pendingMessages: PendingMessage[];
  statusLine: StyledLine | null;
}

export function buildComposerLines(
  state: Pick<TerminalRendererState, "composer" | "pendingMessages">,
  width = getTerminalColumns()
): StyledLine[] {
  const composerWidth = Math.max(1, width);
  const composerSurfaceLine = (content: string) => {
    const padding = " ".repeat(
      Math.max(0, composerWidth - visibleLength(content))
    );
    return {
      segments: `${content}${padding}`
        .split(/(\[(?:Text|Image) #\d+\])/)
        .flatMap(
          (part) =>
            styledLine(part, {
              background: "surface",
              ...(/^\[(?:Text|Image) #\d+\]$/.test(part)
                ? { color: "cyan" as const }
                : {}),
            }).segments
        ),
    };
  };
  const pendingLines = formatPendingDisplayLines(
    state.pendingMessages,
    width
  ).map((line) => styledLine(line, { dim: true }));
  const images = Array.from(
    { length: state.composer.imageCount ?? 0 },
    (_, index) => `[Image #${index + 1}] `
  ).join("");
  const display = images + normalizePastedText(state.composer.value);
  // Reserve cursor space during both blink phases so input never reflows.
  const inputWidth = Math.max(1, composerWidth - 1);
  const inputLines = splitInputDisplayLines(
    display,
    state.composer.prefix.length,
    inputWidth
  );
  const continuationPrefix = " ".repeat(state.composer.prefix.length);
  const lines: StyledLine[] = [...pendingLines];

  lines.push(composerSurfaceLine(""));

  for (let index = 0; index < inputLines.length; index += 1) {
    const lineText = inputLines[index] ?? "";
    const linePrefix = index === 0 ? state.composer.prefix : continuationPrefix;
    const isLastInputLine = index === inputLines.length - 1;
    const cursor = state.composer.cursorVisible && isLastInputLine ? "▌" : "";
    const content = `${linePrefix}${lineText}${cursor}`;

    lines.push(composerSurfaceLine(content));
  }

  lines.push(composerSurfaceLine(""));

  const labelWidth = 14;
  const suggestionPrefixWidth = labelWidth + 3;

  for (let index = 0; index < state.composer.suggestions.length; index += 1) {
    const suggestion = state.composer.suggestions[index];
    const selected = index === state.composer.selectedIndex;
    const marker = selected ? "›" : " ";
    const label = truncateText(suggestion.label, labelWidth);
    const labelPadding = Math.max(0, labelWidth - visibleLength(label));
    const descriptionWidth = Math.max(0, width - suggestionPrefixWidth);
    const description = truncateText(suggestion.description, descriptionWidth);
    const content = `${marker} ${label}${" ".repeat(labelPadding)} ${description}`;

    lines.push(
      selected ? styledLine(content, { color: "cyan" }) : plainLine(content)
    );
  }

  if (lines.length === 0) {
    const cursor = state.composer.cursorVisible ? "▌" : "";
    const content = `${state.composer.prefix}${cursor}`;
    return [
      composerSurfaceLine(""),
      composerSurfaceLine(content),
      composerSurfaceLine(""),
    ];
  }

  return lines;
}

function cloneComposerState(state: ComposerState): ComposerState {
  return {
    ...state,
    suggestions: [...state.suggestions],
  };
}

export class TerminalRenderer {
  private readonly layout: TerminalLayout;
  private state: TerminalRendererState = {
    composer: {
      cursorVisible: true,
      prefix: "> ",
      selectedIndex: 0,
      suggestions: [],
      value: "",
    },
    pendingMessages: [],
    statusLine: null,
  };

  constructor(
    terminalInput: TerminalInput | null = null,
    layout: TerminalLayout = new TerminalLayout(terminalInput)
  ) {
    this.layout = layout;
  }

  apply(): boolean {
    return this.layout.apply();
  }

  async anchorFromCursor(): Promise<void> {
    await this.layout.anchorFromCursor();
  }

  reset(): void {
    this.state = {
      composer: {
        cursorVisible: true,
        prefix: "> ",
        selectedIndex: 0,
        suggestions: [],
        value: "",
      },
      pendingMessages: [],
      statusLine: null,
    };
    this.layout.reset();
  }

  isEnabled(): boolean {
    return this.layout.isEnabled();
  }

  clear(): void {
    this.state.statusLine = null;
    this.layout.clear();
  }

  setComposerState(state: ComposerState): void {
    this.state.composer = cloneComposerState(state);
    this.renderComposer();
  }

  setPendingMessages(messages: PendingMessage[]): void {
    this.state.pendingMessages = [...messages];
    this.renderComposer();
  }

  setStatusLine(text: StyledLine | null): void {
    this.state.statusLine = text ? cloneStyledLine(text) : null;

    if (text === null) {
      this.layout.clearStatusLine();
      return;
    }

    this.layout.writeStatusLine(text);
  }

  beginStream(): void {
    this.state.statusLine = null;
    this.layout.beginMessage("assistant");
    this.layout.beginStream();
  }

  endStream(): void {
    this.state.statusLine = null;
    this.layout.endStream();
    this.layout.endMessage();
  }

  appendStreamChunk(text: string): void {
    this.layout.writeScroll(text);
  }

  appendOutputLine(text: string | StyledLine): void {
    this.layout.beginMessage("output");
    this.layout.writelnScroll(text);
    this.layout.endMessage();
  }

  appendToolLine(text: string | StyledLine): void {
    this.layout.beginMessage("tool");
    this.layout.writelnScroll(text);
    this.layout.endMessage();
  }

  appendUserMessage(line: string, options: UserMessageOptions = {}): void {
    const prefix = options.prefix ?? "> ";
    const placement = options.placement ?? "scroll";
    const lines = line.split("\n");

    this.layout.beginMessage("user");
    for (let index = 0; index < lines.length; index += 1) {
      const linePrefix = index === 0 ? prefix : " ".repeat(prefix.length);
      const text = `${linePrefix}${lines[index] ?? ""}`;

      if (placement === "below_status") {
        this.layout.writelnBelowStatus(text);
      } else {
        this.layout.writelnScroll(text);
      }
    }
    this.layout.endMessage();
  }

  getState(): TerminalRendererState {
    return {
      composer: cloneComposerState(this.state.composer),
      pendingMessages: [...this.state.pendingMessages],
      statusLine: this.state.statusLine
        ? cloneStyledLine(this.state.statusLine)
        : null,
    };
  }

  scrollPage(deltaPages: number): void {
    this.layout.scrollPage(deltaPages);
  }

  scrollLines(deltaLines: number): void {
    this.layout.scrollLines(deltaLines);
  }

  scrollToLatest(): void {
    this.layout.scrollToLatest();
  }

  setDebugOverlay(enabled: boolean): void {
    this.layout.setDebugOverlay(enabled);
  }

  isDebugOverlayEnabled(): boolean {
    return this.layout.isDebugOverlayEnabled();
  }

  private renderComposer(): void {
    const lines = buildComposerLines(this.state);
    this.layout.setReservedRows(lines.length, lines);
  }
}
