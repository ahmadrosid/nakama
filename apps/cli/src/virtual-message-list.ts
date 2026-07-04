import { plainLine, styledLine, type StyledLine } from "./styled-text";
import { visibleLength, wrapText } from "./text-measure";

export type MessageKind = "user" | "output" | "assistant" | "tool";

export interface VirtualMessage {
  text: string;
  kind: MessageKind;
}

/**
 * Manages transcript messages and provides line-level access with lazy
 * wrapping. Only messages that overlap the requested line range get their
 * content computed, keeping render cost proportional to viewport size rather
 * than total conversation length.
 *
 * Offsets are maintained incrementally — appending a new message only wraps
 * that one message, not the entire history. A terminal width change forces a
 * full recompute but that happens infrequently.
 *
 * Two usage modes:
 * 1. **Explicit message boundaries** via beginMessage/endMessage — multiple
 *    appendLine calls group into a single multi-line message.
 * 2. **Implicit single-line messages** — calling appendLine without
 *    beginMessage creates a one-line message per call.
 */
export class VirtualMessageList {
  private static readonly HORIZONTAL_PADDING = 1;
  private static readonly MESSAGE_GAP_LINES = 1;
  private messages: VirtualMessage[] = [];
  private currentText: string[] = [];
  private currentKind: MessageKind = "output";
  private hasOpenMessage = false;

  // Cached line offsets at cachedWidth: offsets[i] = starting line of msg i.
  // Guarantee: offsets.length === messages.length + 1 when fully computed.
  private cachedWidth = 0;
  private offsets: number[] = [0];
  private wrappedCache = new Map<number, string[]>();

  // ── Mutation ──────────────────────────────────────────────────────

  /** Start accumulating lines for a new multi-line message. */
  beginMessage(kind: MessageKind): void {
    this.sealMessage();
    this.currentKind = kind;
    this.hasOpenMessage = true;
  }

  /**
   * Add text to the current message.
   *
   * If beginMessage was called, the text accumulates into the open message.
   * Otherwise, each call creates an individual single-line message, which is
   * the expected behaviour when writelnScroll is called without explicit
   * message boundaries (e.g. from tests).
   */
  appendLine(text: string): void {
    if (this.hasOpenMessage) {
      this.currentText.push(text);
      return;
    }

    // Implicit single-line message
    this.messages.push({ text, kind: "output" });
    this.invalidateOffsets();
  }

  /** Finalize the current multi-line message, if any. */
  sealMessage(): void {
    if (!this.hasOpenMessage || this.currentText.length === 0) return;
    this.messages.push({
      text: this.currentText.join("\n"),
      kind: this.currentKind,
    });
    this.currentText = [];
    this.hasOpenMessage = false;
    this.invalidateOffsets();
  }

  clear(): void {
    this.messages = [];
    this.currentText = [];
    this.currentKind = "output";
    this.hasOpenMessage = false;
    this.cachedWidth = 0;
    this.offsets = [0];
    this.wrappedCache.clear();
  }

  get messageCount(): number {
    return this.messages.length;
  }

  // ── Internal offset management ────────────────────────────────────

  private invalidateOffsets(): void {
    // Keep offsets up to the last known message count so incremental
    // recompute can pick up from there.
    if (this.offsets.length > this.messages.length + 1) {
      this.offsets = this.offsets.slice(0, this.messages.length);
    }
  }

  /**
   * Ensure offsets and wrapped lines are up to date for `width`.
   * Only newly-added messages are computed; previously-cached results are
   * reused. A width change forces a full rewrap.
   */
  private ensureWidth(width: number): void {
    if (width === this.cachedWidth && this.offsets.length === this.messages.length + 1) {
      return; // fully up to date
    }

    if (width !== this.cachedWidth) {
      this.cachedWidth = width;
      this.offsets = [0];
      this.wrappedCache.clear();
    }

    // Ensure we have at least the base offset
    if (this.offsets.length === 0) {
      this.offsets = [0];
    }

    // Incrementally compute offsets for uncached messages
    const startFrom = Math.max(0, this.offsets.length - 1);
    for (let i = startFrom; i < this.messages.length; i++) {
      let lines = this.wrappedCache.get(i);
      if (!lines) {
        lines = this.formatMessageLines(
          this.messages[i].text,
          width,
          this.shouldInsertLeadingGap(i, this.messages[i].kind),
          this.messages[i].kind,
        );
        this.wrappedCache.set(i, lines);
      }
      this.offsets.push(this.offsets[this.offsets.length - 1] + lines.length);
    }
  }

  private contentWidth(width: number): number {
    return Math.max(1, width - VirtualMessageList.HORIZONTAL_PADDING * 2);
  }

  private wrapMessageText(text: string, width: number): string[] {
    const logicalLines = text.replace(/\r\n?/g, "\n").split("\n");
    const wrappedLines: string[] = [];

    for (const logicalLine of logicalLines) {
      if (logicalLine === "") {
        wrappedLines.push("");
        continue;
      }

      wrappedLines.push(...wrapText(logicalLine, this.contentWidth(width)));
    }

    return wrappedLines.length > 0 ? wrappedLines : [""];
  }

  private padLine(text: string): string {
    return `${" ".repeat(VirtualMessageList.HORIZONTAL_PADDING)}${text}${" ".repeat(VirtualMessageList.HORIZONTAL_PADDING)}`;
  }

  private surfaceLine(text: string, width: number): string {
    return `${text}${" ".repeat(Math.max(0, Math.max(1, width) - visibleLength(text)))}`;
  }

  private formatUserMessageLines(text: string, width: number): string[] {
    const contentWidth = Math.max(1, width);
    const lines = this.wrapMessageText(text, width + VirtualMessageList.HORIZONTAL_PADDING * 2).map(
      (line) => this.surfaceLine(line, contentWidth),
    );
    // Submitted user messages intentionally keep a padded blank row above and
    // below the content to preserve the "bubble" treatment in the CLI.
    return [this.surfaceLine("", contentWidth), ...lines, this.surfaceLine("", contentWidth)];
  }

  private formatMessageLines(
    text: string,
    width: number,
    withLeadingGap: boolean,
    kind: MessageKind,
  ): string[] {
    const lines =
      kind === "user"
        ? this.formatUserMessageLines(text, width)
        : this.wrapMessageText(text, width).map((line) => this.padLine(line));
    if (!withLeadingGap) {
      return lines;
    }

    return Array.from({ length: VirtualMessageList.MESSAGE_GAP_LINES }, () => "").concat(lines);
  }

  private shouldInsertLeadingGap(index: number, kind: MessageKind): boolean {
    if (index === 0) {
      return false;
    }

    return kind === "assistant" || kind === "user" || kind === "tool";
  }

  private openMessageLines(width: number): string[] {
    if (!this.hasOpenMessage || this.currentText.length === 0) {
      return [];
    }

    return this.formatMessageLines(
      this.currentText.join("\n"),
      width,
      this.shouldInsertLeadingGap(this.messages.length, this.currentKind),
      this.currentKind,
    );
  }

  // ── Line resolution (lazy) ────────────────────────────────────────

  /** Total number of wrapped lines at the given width. */
  totalLines(width: number): number {
    this.ensureWidth(width);
    return this.offsets[this.messages.length] + this.openMessageLines(width).length;
  }

  /**
   * Return the wrapped lines in the range [start, end) at the given width.
   * Only messages that overlap the range are actually wrapped — the rest
   * are skipped.
   */
  getLines(start: number, end: number, width: number): StyledLine[] {
    this.ensureWidth(width);
    const result: StyledLine[] = [];

    for (let i = 0; i < this.messages.length; i++) {
      const msgStart = this.offsets[i];
      const msgEnd = this.offsets[i + 1];

      if (msgEnd <= start) continue;
      if (msgStart >= end) break;

      let lines = this.wrappedCache.get(i);
      if (!lines) {
        lines = this.formatMessageLines(
          this.messages[i].text,
          width,
          this.shouldInsertLeadingGap(i, this.messages[i].kind),
          this.messages[i].kind,
        );
        this.wrappedCache.set(i, lines);
      }

      const localStart = Math.max(0, start - msgStart);
      const localEnd = Math.min(lines.length, end - msgStart);
      for (let j = localStart; j < localEnd; j++) {
        result.push(this.styledMessageLine(this.messages[i].kind, lines[j]));
      }
    }

    const openLines = this.openMessageLines(width);
    if (openLines.length === 0) {
      return result;
    }

    const openStart = this.offsets[this.messages.length];
    const openEnd = openStart + openLines.length;
    if (openEnd <= start || openStart >= end) {
      return result;
    }

    const localStart = Math.max(0, start - openStart);
    const localEnd = Math.min(openLines.length, end - openStart);
    for (let i = localStart; i < localEnd; i++) {
      result.push(this.styledMessageLine(this.currentKind, openLines[i]));
    }

    return result;
  }

  // ── Navigation helpers ────────────────────────────────────────────

  /**
   * Return the line offset of the nearest message boundary relative to
   * `currentLine`.
   *
   * - direction "up": snap to the start of the current message (or previous
   *   message if already at the start of the current).
   * - direction "down": snap to the start of the next message.
   */
  snapToMessage(currentLine: number, direction: "up" | "down", width: number): number {
    this.ensureWidth(width);
    const openLines = this.openMessageLines(width);
    const count = this.messages.length + (openLines.length > 0 ? 1 : 0);
    if (count === 0) return currentLine;

    for (let i = 0; i < count; i++) {
      const msgStart = this.offsets[i];
      const msgEnd =
        i < this.messages.length ? this.offsets[i + 1] : msgStart + openLines.length;

      if (currentLine < msgStart || currentLine >= msgEnd) continue;

      if (direction === "up") {
        if (currentLine - msgStart > 0) return msgStart;
        if (i > 0) return this.offsets[i - 1];
        return msgStart;
      }

      if (i + 1 < count) return this.offsets[i + 1];
      return msgEnd - 1;
    }

    return currentLine;
  }

  /** Return the message index and local line offset for a given global line. */
  messageAtLine(line: number, width: number): { index: number; lineOffset: number } | null {
    this.ensureWidth(width);
    for (let i = 0; i < this.messages.length; i++) {
      const msgStart = this.offsets[i];
      const msgEnd = this.offsets[i + 1];
      if (line >= msgStart && line < msgEnd) {
        return { index: i, lineOffset: line - msgStart };
      }
    }

    const openLines = this.openMessageLines(width);
    if (openLines.length === 0) {
      return null;
    }

    const openStart = this.offsets[this.messages.length];
    if (line >= openStart && line < openStart + openLines.length) {
      return { index: this.messages.length, lineOffset: line - openStart };
    }

    return null;
  }

  /** The wrapped line content for a single message (cached). */
  messageLines(index: number, width: number): string[] {
    this.ensureWidth(width);
    if (index === this.messages.length) {
      return this.openMessageLines(width);
    }
    const cached = this.wrappedCache.get(index);
    if (cached) return cached;
    const lines = this.formatMessageLines(
      this.messages[index].text,
      width,
      this.shouldInsertLeadingGap(index, this.messages[index].kind),
      this.messages[index].kind,
    );
    this.wrappedCache.set(index, lines);
    return lines;
  }

  private styledMessageLine(kind: MessageKind, line: string): StyledLine {
    if (kind === "user" && line !== "") {
      return styledLine(line, { background: "surface" });
    }

    return plainLine(line);
  }
}
