import * as readline from "node:readline/promises";
import type { PromptSuggestion } from "./commands";

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

export async function promptLine(
  prefix = "> ",
  options: PromptLineOptions = {},
): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return promptLineFallback(prefix);
  }

  const getSuggestions = options.getSuggestions ?? (() => []);

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = "";
    let cursorVisible = true;
    let closed = false;
    let selectedIndex = 0;
    let previousRenderedLines = 0;
    let hasNavigated = false;

    const blinkTimer = setInterval(() => {
      cursorVisible = !cursorVisible;
      render();
    }, BLINK_INTERVAL_MS);

    function currentSuggestions(): PromptSuggestion[] {
      return getSuggestions(value).slice(0, MAX_VISIBLE_SUGGESTIONS);
    }

    function render() {
      const suggestions = currentSuggestions();
      const cursor = cursorVisible ? CURSOR_CHAR : " ";
      const renderedLines = Math.max(suggestions.length, previousRenderedLines);

      stdout.write(`\r\x1b[K${prefix}${value}${cursor}`);

      for (let index = 0; index < renderedLines; index += 1) {
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

      if (renderedLines > 0) {
        stdout.write(`\x1b[${renderedLines}A`);
      }

      previousRenderedLines = suggestions.length;
      stdout.write(`\r\x1b[${prefix.length + value.length + 1}C`);
    }

    function clearBelowInput() {
      stdout.write(`\r\x1b[${prefix.length + value.length + 1}C\x1b[J`);
    }

    function applySuggestion(suggestion: PromptSuggestion, submitAfter = false) {
      value = suggestion.insertValue.trimEnd();
      selectedIndex = 0;
      hasNavigated = false;
      cursorVisible = true;

      if (submitAfter) {
        cleanup();
        resolve(value);
        return;
      }

      render();
    }

    function resetSelection() {
      selectedIndex = 0;
      hasNavigated = false;
    }

    function cleanup() {
      if (closed) {
        return;
      }

      closed = true;
      clearInterval(blinkTimer);
      stdin.setRawMode(false);
      stdin.off("data", onData);
      stdout.write("\x1b[?25h");
      clearBelowInput();
      stdout.write(`\r\x1b[K${prefix}${value}\n`);
    }

    function submit() {
      const suggestions = currentSuggestions();

      if (hasNavigated && suggestions.length > 0) {
        const suggestion = suggestions[selectedIndex] ?? suggestions[0];

        if (suggestion) {
          applySuggestion(suggestion, true);
          return;
        }
      }

      cleanup();
      resolve(value);
    }

    function cancel() {
      cleanup();
      reject(new PromptCancelledError());
    }

    function onData(chunk: Buffer | string) {
      const key = String(chunk);

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

      if (key === "\u007f" || key === "\b") {
        value = value.slice(0, -1);
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

        value += printable;
        resetSelection();
        cursorVisible = true;
        render();
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
    stdin.on("data", onData);
    render();
  });
}

async function promptLineFallback(prefix: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return (await rl.question(prefix)).trimEnd();
  } finally {
    rl.close();
  }
}

export async function promptSecret(prefix = "API key: "): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return promptLineFallback(prefix);
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = "";
    let cursorVisible = true;
    let closed = false;

    const blinkTimer = setInterval(() => {
      cursorVisible = !cursorVisible;
      render();
    }, BLINK_INTERVAL_MS);

    function render() {
      const masked = "*".repeat(value.length);
      const cursor = cursorVisible ? CURSOR_CHAR : " ";
      stdout.write(`\r\x1b[K${prefix}${masked}${cursor}`);
    }

    function cleanup() {
      if (closed) {
        return;
      }

      closed = true;
      clearInterval(blinkTimer);
      stdin.setRawMode(false);
      stdin.off("data", onData);
      stdout.write("\x1b[?25h");
      stdout.write(`\r\x1b[K${prefix}${"*".repeat(value.length)}\n`);
    }

    function submit() {
      cleanup();
      resolve(value);
    }

    function cancel() {
      cleanup();
      reject(new PromptCancelledError());
    }

    function onData(chunk: Buffer | string) {
      const key = String(chunk);

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

      if (key === "\u007f" || key === "\b") {
        value = value.slice(0, -1);
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

        value += printable;
        cursorVisible = true;
        render();
        return;
      }

      if (key.length === 1 && key >= " ") {
        value += key;
        cursorVisible = true;
        render();
      }
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdout.write("\x1b[?25l");
    stdin.on("data", onData);
    render();
  });
}
