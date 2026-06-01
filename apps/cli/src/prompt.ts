import * as readline from "node:readline/promises";
import type { ImageAttachment } from "@tinyclaw/core";
import type { PromptSuggestion } from "./commands";
import { isClipboardImagePasteSupported, readClipboardImage } from "./clipboard-image";
import {
  formatInputForDisplay,
  normalizePastedText,
  splitInputDisplayLines,
} from "./prompt-display";

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

const BLINK_INTERVAL_MS = 530;
const CURSOR_CHAR = "▌";
const MAX_VISIBLE_SUGGESTIONS = 8;

export class PromptCancelledError extends Error {
  constructor() {
    super("Prompt cancelled");
    this.name = "PromptCancelledError";
  }
}

export interface PromptLineOptions {
  getSuggestions?: (input: string) => PromptSuggestion[];
}

export interface PromptLineResult {
  text: string;
  images?: ImageAttachment[];
}

export async function promptLine(
  prefix = "> ",
  options: PromptLineOptions = {},
): Promise<PromptLineResult> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return promptLineFallback(prefix);
  }

  const getSuggestions = options.getSuggestions ?? (() => []);

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = "";
    let attachedImages: ImageAttachment[] = [];
    let cursorVisible = true;
    let closed = false;
    let selectedIndex = 0;
    let previousBlockHeight = 1;
    let cursorOffsetFromBlockStart = 0;
    let previousRenderedLines = 0;
    let hasNavigated = false;
    let pasteBuffer = "";
    let inBracketedPaste = false;
    let blinkTimer: ReturnType<typeof setInterval> | null = null;
    let clipboardAttachTask: Promise<void> = Promise.resolve();
    const clipboardPasteSupported = isClipboardImagePasteSupported();

    function writeCursorCell() {
      stdout.write(cursorVisible ? CURSOR_CHAR : " ");
    }

    function toggleCursorBlink() {
      stdout.write("\b");
      writeCursorCell();
    }

    function startBlink() {
      if (blinkTimer || closed) {
        return;
      }

      blinkTimer = setInterval(() => {
        cursorVisible = !cursorVisible;
        toggleCursorBlink();
      }, BLINK_INTERVAL_MS);
    }

    function stopBlink() {
      if (!blinkTimer) {
        return;
      }

      clearInterval(blinkTimer);
      blinkTimer = null;
    }

    function currentSuggestions(): PromptSuggestion[] {
      return getSuggestions(value).slice(0, MAX_VISIBLE_SUGGESTIONS);
    }

    function moveToBlockStart() {
      if (cursorOffsetFromBlockStart > 0) {
        stdout.write(`\x1b[${cursorOffsetFromBlockStart}A`);
      }
    }

    function render() {
      const suggestions = currentSuggestions();
      const display = formatInputForDisplay(value);
      const width = stdout.columns ?? 80;
      const inputLines = splitInputDisplayLines(display, prefix.length, width);
      const suggestionLines = Math.max(suggestions.length, previousRenderedLines);
      const continuationPrefix = " ".repeat(prefix.length);
      const totalLines = inputLines.length + suggestionLines;

      moveToBlockStart();

      for (let index = 0; index < inputLines.length; index += 1) {
        const lineText = inputLines[index] ?? "";
        const linePrefix = index === 0 ? prefix : continuationPrefix;

        if (index === 0) {
          stdout.write(`\r\x1b[K${linePrefix}${lineText}`);
        } else {
          stdout.write(`\n\x1b[K${linePrefix}${lineText}`);
        }
      }

      for (let index = 0; index < suggestionLines; index += 1) {
        const suggestion = suggestions[index];

        if (suggestion) {
          const selected = index === selectedIndex;
          const marker = selected ? "›" : " ";
          const content = `${marker} ${suggestion.label.padEnd(14)} ${suggestion.description}`;

          if (selected) {
            stdout.write(`\n\x1b[K\x1b[36m${content}\x1b[0m`);
          } else {
            stdout.write(`\n\x1b[K${content}`);
          }
        } else {
          stdout.write("\n\x1b[K");
        }
      }

      if (totalLines < previousBlockHeight) {
        for (let index = totalLines; index < previousBlockHeight; index += 1) {
          stdout.write("\n\x1b[K");
        }

        const extraLines = previousBlockHeight - totalLines;

        if (extraLines > 0) {
          stdout.write(`\x1b[${extraLines}A`);
        }
      }

      const lastInputRow = inputLines.length - 1;
      const lastLine = inputLines[lastInputRow] ?? "";
      const lastLinePrefix = lastInputRow === 0 ? prefix : continuationPrefix;
      const rowsUpFromBottom = totalLines - 1 - lastInputRow;

      if (rowsUpFromBottom > 0) {
        stdout.write(`\x1b[${rowsUpFromBottom}A`);
      }

      stdout.write(`\r\x1b[${lastLinePrefix.length + lastLine.length}C`);
      writeCursorCell();

      previousBlockHeight = Math.max(totalLines, 1);
      cursorOffsetFromBlockStart = lastInputRow;
      previousRenderedLines = suggestions.length;
    }

    function applySuggestion(suggestion: PromptSuggestion, submitAfter = false) {
      value = suggestion.insertValue.trimEnd();
      selectedIndex = 0;
      hasNavigated = false;
      cursorVisible = true;

      if (submitAfter) {
        void waitForClipboardAttach().then(() => {
          cleanup();
          resolve({
            text: value,
            images: attachedImages.length > 0 ? attachedImages : undefined,
          });
        });
        return;
      }

      render();
    }

    function resetSelection() {
      selectedIndex = 0;
      hasNavigated = false;
    }

    function echoSubmittedValue(text: string) {
      const lines = text.split("\n");

      for (let index = 0; index < lines.length; index += 1) {
        const linePrefix = index === 0 ? prefix : " ".repeat(prefix.length);
        stdout.write(`${linePrefix}${lines[index] ?? ""}\n`);
      }
    }

    function cleanup() {
      if (closed) {
        return;
      }

      closed = true;
      stopBlink();
      stdin.setRawMode(false);
      stdin.off("data", onData);
      stdout.write("\x1b[?2004l");
      stdout.write("\x1b[?25h");
      moveToBlockStart();

      for (let index = 0; index < previousBlockHeight; index += 1) {
        stdout.write("\r\x1b[K");

        if (index < previousBlockHeight - 1) {
          stdout.write("\n");
        }
      }

      if (previousBlockHeight > 1) {
        stdout.write(`\x1b[${previousBlockHeight - 1}A`);
      }

      echoSubmittedValue(value);
    }

    function notifyClipboard(message: string) {
      process.stderr.write(`\x1b[33m${message}\x1b[0m\n`);
      render();
    }

    function queueClipboardAttach(): void {
      clipboardAttachTask = attachClipboardImage().then(() => undefined);
    }

    async function waitForClipboardAttach(): Promise<void> {
      await clipboardAttachTask;
    }

    async function attachClipboardImage(): Promise<boolean> {
      if (!clipboardPasteSupported) {
        notifyClipboard("Clipboard images are not supported on this platform.");
        return false;
      }

      try {
        const image = await readClipboardImage();

        if (!image) {
          notifyClipboard("No image on clipboard. Copy a screenshot or image first.");
          return false;
        }

        attachedImages.push(image);
        resetSelection();
        cursorVisible = true;
        process.stderr.write("\x1b[2mImage attached (backspace to remove)\x1b[0m\n");
        render();
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to read clipboard image.";
        notifyClipboard(message);
        return false;
      }
    }

    function finishBracketedPaste(pasted: string) {
      inBracketedPaste = false;
      pasteBuffer = "";
      startBlink();

      const normalized = normalizePastedText(pasted);

      if (normalized.trim()) {
        value += normalized;
        resetSelection();
        cursorVisible = true;
        render();
        return;
      }

      queueClipboardAttach();
    }

    async function submit() {
      await waitForClipboardAttach();

      const suggestions = currentSuggestions();

      if (hasNavigated && suggestions.length > 0) {
        const suggestion = suggestions[selectedIndex] ?? suggestions[0];

        if (suggestion) {
          applySuggestion(suggestion, true);
          return;
        }
      }

      cleanup();
      resolve({
        text: value,
        images: attachedImages.length > 0 ? attachedImages : undefined,
      });
    }

    function cancel() {
      cleanup();
      reject(new PromptCancelledError());
    }

    function onData(chunk: Buffer | string) {
      const key = String(chunk);

      if (inBracketedPaste) {
        pasteBuffer += key;

        const endIndex = pasteBuffer.indexOf(BRACKETED_PASTE_END);

        if (endIndex >= 0) {
          const pasted = pasteBuffer.slice(0, endIndex);
          finishBracketedPaste(pasted);
        }

        return;
      }

      if (key.includes(BRACKETED_PASTE_START)) {
        stopBlink();
        const startIndex = key.indexOf(BRACKETED_PASTE_START);
        const before = key.slice(0, startIndex);

        if (before) {
          value += before;
        }

        inBracketedPaste = true;
        pasteBuffer = key.slice(startIndex + BRACKETED_PASTE_START.length);

        const endIndex = pasteBuffer.indexOf(BRACKETED_PASTE_END);

        if (endIndex >= 0) {
          const pasted = pasteBuffer.slice(0, endIndex);
          finishBracketedPaste(pasted);
        }

        return;
      }

      if (key === "\u0003") {
        cancel();
        return;
      }

      if (key === "\u0004" && value.length === 0) {
        cancel();
        return;
      }

      if (key === "\r" || key === "\n") {
        submit();
        return;
      }

      if (key === "\u001b[A") {
        const suggestions = currentSuggestions();

        if (suggestions.length > 0) {
          hasNavigated = true;
          selectedIndex = (selectedIndex - 1 + suggestions.length) % suggestions.length;
          render();
        }

        return;
      }

      if (key === "\u001b[B") {
        const suggestions = currentSuggestions();

        if (suggestions.length > 0) {
          hasNavigated = true;
          selectedIndex = (selectedIndex + 1) % suggestions.length;
          render();
        }

        return;
      }

      if (key === "\t") {
        const suggestions = currentSuggestions();
        const suggestion = suggestions[selectedIndex] ?? suggestions[0];

        if (suggestion) {
          applySuggestion(suggestion);
        }

        return;
      }

      if (key === "\u0016") {
        queueClipboardAttach();
        return;
      }

      if (key === "\u007f" || key === "\b") {
        if (value.length > 0) {
          value = value.slice(0, -1);
        } else if (attachedImages.length > 0) {
          attachedImages.pop();
        }

        resetSelection();
        cursorVisible = true;
        render();
        return;
      }

      if (key.startsWith("\u001b")) {
        return;
      }

      if (key.length > 1) {
        const printable = [...key].filter((char) => char >= " " && char !== "\u007f").join("");

        if (!printable) {
          return;
        }

        stopBlink();
        value += normalizePastedText(printable);
        resetSelection();
        cursorVisible = true;
        render();
        startBlink();
        return;
      }

      if (key.length === 1 && key >= " ") {
        value += key;
        resetSelection();
        cursorVisible = true;
        render();
      }
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdout.write("\x1b[?25l");
    stdout.write("\x1b[?2004h");
    stdin.on("data", onData);
    startBlink();
    render();
  });
}

async function promptLineFallback(prefix: string): Promise<PromptLineResult> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return { text: (await rl.question(prefix)).trimEnd() };
  } finally {
    rl.close();
  }
}
