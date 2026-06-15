import type { TerminalInput } from "./terminal-input";
import { getTerminalColumns, TerminalLayout } from "./terminal-layout";
import {
  formatPendingDisplayLines,
  type PendingMessage,
} from "./message-queue";
import { formatInputForDisplay, splitInputDisplayLines } from "./prompt-display";
import { truncateText, visibleLength } from "./text-measure";

export interface ComposerRenderer {
  setComposerState(state: ComposerState): void;
}

export interface StatusRenderer {
  isEnabled(): boolean;
  setStatusLine(text: string | null): void;
}

export interface ComposerSuggestion {
  label: string;
  description: string;
}

export interface ComposerState {
  prefix: string;
  value: string;
  cursorVisible: boolean;
  suggestions: ComposerSuggestion[];
  selectedIndex: number;
}

export interface TranscriptEntry {
  kind: "user" | "output" | "assistant";
  text: string;
}

export interface StreamState {
  active: boolean;
  text: string;
}

export interface UserMessageOptions {
  placement?: "scroll" | "below_status";
  prefix?: string;
}

export interface TerminalRendererState {
  composer: ComposerState;
  pendingMessages: PendingMessage[];
  transcript: TranscriptEntry[];
  statusLine: string | null;
  stream: StreamState;
}

export function buildComposerLines(
  state: Pick<TerminalRendererState, "composer" | "pendingMessages">,
  width = getTerminalColumns(),
): string[] {
  const pendingLines = formatPendingDisplayLines(state.pendingMessages, width);
  const display = formatInputForDisplay(state.composer.value);
  const inputLines = splitInputDisplayLines(display, state.composer.prefix.length, width);
  const continuationPrefix = " ".repeat(state.composer.prefix.length);
  const lines: string[] = [...pendingLines];

  for (let index = 0; index < inputLines.length; index += 1) {
    const lineText = inputLines[index] ?? "";
    const linePrefix = index === 0 ? state.composer.prefix : continuationPrefix;
    const isLastInputLine = index === inputLines.length - 1;
    const cursor = state.composer.cursorVisible && isLastInputLine ? "▌" : "";

    lines.push(`${linePrefix}${lineText}${cursor}`);
  }

  const labelWidth = 14;
  const suggestionPrefixWidth = labelWidth + 3; // marker + space + label + space

  for (let index = 0; index < state.composer.suggestions.length; index += 1) {
    const suggestion = state.composer.suggestions[index];
    const selected = index === state.composer.selectedIndex;
    const marker = selected ? "›" : " ";
    const label = truncateText(suggestion.label, labelWidth);
    const labelPadding = Math.max(0, labelWidth - visibleLength(label));
    const descriptionWidth = Math.max(0, width - suggestionPrefixWidth);
    const description = truncateText(suggestion.description, descriptionWidth);
    const content = `${marker} ${label}${" ".repeat(labelPadding)} ${description}`;

    if (selected) {
      lines.push(`\x1b[36m${content}\x1b[0m`);
    } else {
      lines.push(content);
    }
  }

  if (lines.length === 0) {
    const cursor = state.composer.cursorVisible ? "▌" : "";
    return [`${state.composer.prefix}${cursor}`];
  }

  return lines;
}

function cloneComposerState(state: ComposerState): ComposerState {
  return {
    ...state,
    suggestions: [...state.suggestions],
  };
}

function clonePendingMessages(messages: PendingMessage[]): PendingMessage[] {
  return [...messages];
}

function cloneTranscript(entries: TranscriptEntry[]): TranscriptEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

export class TerminalRenderer implements ComposerRenderer, StatusRenderer {
  private readonly layout: TerminalLayout;
  private state: TerminalRendererState = {
    composer: {
      prefix: "> ",
      value: "",
      cursorVisible: true,
      suggestions: [],
      selectedIndex: 0,
    },
    pendingMessages: [],
    transcript: [],
    statusLine: null,
    stream: {
      active: false,
      text: "",
    },
  };

  constructor(
    terminalInput: TerminalInput | null = null,
    layout: TerminalLayout = new TerminalLayout(terminalInput),
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
        prefix: "> ",
        value: "",
        cursorVisible: true,
        suggestions: [],
        selectedIndex: 0,
      },
      pendingMessages: [],
      transcript: [],
      statusLine: null,
      stream: {
        active: false,
        text: "",
      },
    };
    this.layout.reset();
  }

  isEnabled(): boolean {
    return this.layout.isEnabled();
  }

  setComposerState(state: ComposerState): void {
    this.state.composer = cloneComposerState(state);
    this.renderComposer();
  }

  setPendingMessages(messages: PendingMessage[]): void {
    this.state.pendingMessages = clonePendingMessages(messages);
    this.renderComposer();
  }

  setStatusLine(text: string | null): void {
    this.state.statusLine = text;

    if (text === null) {
      this.layout.clearStatusLine();
      return;
    }

    this.layout.writeStatusLine(text);
  }

  beginStream(): void {
    this.state.statusLine = null;
    this.state.stream = {
      active: true,
      text: "",
    };
    this.layout.beginStream();
  }

  endStream(): void {
    if (this.state.stream.text) {
      this.state.transcript.push({
        kind: "assistant",
        text: this.state.stream.text,
      });
    }

    this.state.statusLine = null;
    this.state.stream = {
      active: false,
      text: "",
    };
    this.layout.endStream();
  }

  appendStreamChunk(text: string): void {
    this.state.stream.text += text;
    this.layout.writeScroll(text);
  }

  appendOutputLine(text: string): void {
    this.state.transcript.push({
      kind: "output",
      text,
    });
    this.layout.writelnScroll(text);
  }

  appendUserMessage(line: string, options: UserMessageOptions = {}): void {
    const prefix = options.prefix ?? "> ";
    const placement = options.placement ?? "scroll";
    const lines = line.split("\n");

    for (let index = 0; index < lines.length; index += 1) {
      const linePrefix = index === 0 ? prefix : " ".repeat(prefix.length);
      const text = `${linePrefix}${lines[index] ?? ""}`;

      this.state.transcript.push({
        kind: "user",
        text,
      });

      if (placement === "below_status") {
        this.layout.writelnBelowStatus(text);
      } else {
        this.layout.writelnScroll(text);
      }
    }
  }

  getState(): TerminalRendererState {
    return {
      composer: cloneComposerState(this.state.composer),
      pendingMessages: clonePendingMessages(this.state.pendingMessages),
      transcript: cloneTranscript(this.state.transcript),
      statusLine: this.state.statusLine,
      stream: { ...this.state.stream },
    };
  }

  private renderComposer(): void {
    const lines = buildComposerLines(this.state);
    this.layout.setReservedRows(lines.length, lines);
  }
}
