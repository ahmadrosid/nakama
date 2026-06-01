import type { ImageAttachment } from "@tinyclaw/core";
import type { PromptSuggestion } from "./commands";
import { isClipboardImagePasteSupported, readClipboardImage } from "./clipboard-image";
import { normalizePastedText } from "./prompt-display";
import type { ComposerRenderer } from "./terminal-renderer";
import type { TerminalInput } from "./terminal-input";

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

const BLINK_INTERVAL_MS = 530;
const MAX_VISIBLE_SUGGESTIONS = 8;

export interface PromptLineResult {
  text: string;
  images?: ImageAttachment[];
}

export interface PersistentPromptOptions {
  prefix?: string;
  renderer: ComposerRenderer;
  terminalInput: TerminalInput;
  getSuggestions?: (input: string) => PromptSuggestion[];
  onSubmit: (result: PromptLineResult) => void | Promise<void>;
  onCancel: () => void;
  onAbortStream?: () => void;
}

export class PersistentPrompt {
  private readonly prefix: string;
  private readonly renderer: ComposerRenderer;
  private readonly terminalInput: TerminalInput;
  private readonly getSuggestions: (input: string) => PromptSuggestion[];
  private readonly onSubmit: (result: PromptLineResult) => void | Promise<void>;
  private readonly onCancel: () => void;
  private readonly onAbortStream?: () => void;

  private value = "";
  private attachedImages: ImageAttachment[] = [];
  private cursorVisible = true;
  private active = false;
  private selectedIndex = 0;
  private hasNavigated = false;
  private pasteBuffer = "";
  private inBracketedPaste = false;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private clipboardAttachTask: Promise<void> = Promise.resolve();
  private unsubscribeInput: (() => void) | null = null;
  private readonly clipboardPasteSupported = isClipboardImagePasteSupported();

  constructor(options: PersistentPromptOptions) {
    this.prefix = options.prefix ?? "> ";
    this.renderer = options.renderer;
    this.terminalInput = options.terminalInput;
    this.getSuggestions = options.getSuggestions ?? (() => []);
    this.onSubmit = options.onSubmit;
    this.onCancel = options.onCancel;
    this.onAbortStream = options.onAbortStream;
  }

  start(): void {
    if (this.active) {
      return;
    }

    this.active = true;
    this.unsubscribeInput = this.terminalInput.onInput(this.onData);
    this.startBlink();
    this.render();
  }

  stop(): void {
    if (!this.active) {
      return;
    }

    this.active = false;
    this.stopBlink();
    this.unsubscribeInput?.();
    this.unsubscribeInput = null;
    process.stdout.write("\x1b[?25h");
  }

  private startBlink(): void {
    if (this.blinkTimer) {
      return;
    }

    this.blinkTimer = setInterval(() => {
      this.cursorVisible = !this.cursorVisible;
      this.render();
    }, BLINK_INTERVAL_MS);
  }

  private stopBlink(): void {
    if (!this.blinkTimer) {
      return;
    }

    clearInterval(this.blinkTimer);
    this.blinkTimer = null;
  }

  private currentSuggestions(): PromptSuggestion[] {
    return this.getSuggestions(this.value).slice(0, MAX_VISIBLE_SUGGESTIONS);
  }

  private render(): void {
    if (!this.active) {
      return;
    }

    const suggestions = this.currentSuggestions().map((suggestion) => ({
      label: suggestion.label,
      description: suggestion.description,
    }));

    this.renderer.setComposerState({
      prefix: this.prefix,
      value: this.value,
      cursorVisible: this.cursorVisible,
      suggestions,
      selectedIndex: this.selectedIndex,
    });
  }

  private resetSelection(): void {
    this.selectedIndex = 0;
    this.hasNavigated = false;
  }

  private notifyClipboard(message: string): void {
    process.stderr.write(`\x1b[33m${message}\x1b[0m\n`);
    this.render();
  }

  private queueClipboardAttach(): void {
    this.clipboardAttachTask = this.attachClipboardImage().then(() => undefined);
  }

  private async waitForClipboardAttach(): Promise<void> {
    await this.clipboardAttachTask;
  }

  private async attachClipboardImage(): Promise<boolean> {
    if (!this.clipboardPasteSupported) {
      this.notifyClipboard("Clipboard images are not supported on this platform.");
      return false;
    }

    try {
      const image = await readClipboardImage();

      if (!image) {
        this.notifyClipboard("No image on clipboard. Copy a screenshot or image first.");
        return false;
      }

      this.attachedImages.push(image);
      this.resetSelection();
      this.cursorVisible = true;
      process.stderr.write("\x1b[2mImage attached (backspace to remove)\x1b[0m\n");
      this.render();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read clipboard image.";
      this.notifyClipboard(message);
      return false;
    }
  }

  private finishBracketedPaste(pasted: string): void {
    this.inBracketedPaste = false;
    this.pasteBuffer = "";
    this.startBlink();

    const normalized = normalizePastedText(pasted);

    if (normalized.trim()) {
      this.value += normalized;
      this.resetSelection();
      this.cursorVisible = true;
      this.render();
      return;
    }

    this.queueClipboardAttach();
  }

  private applySuggestion(suggestion: PromptSuggestion, submitAfter = false): void {
    this.value = suggestion.insertValue.trimEnd();
    this.selectedIndex = 0;
    this.hasNavigated = false;
    this.cursorVisible = true;

    if (submitAfter) {
      void this.waitForClipboardAttach().then(() => {
        this.submitValue();
      });
      return;
    }

    this.render();
  }

  private submitValue(): void {
    const result: PromptLineResult = {
      text: this.value,
      images: this.attachedImages.length > 0 ? this.attachedImages : undefined,
    };

    this.value = "";
    this.attachedImages = [];
    this.resetSelection();
    this.cursorVisible = true;
    this.render();
    void this.onSubmit(result);
  }

  private async submit(): Promise<void> {
    await this.waitForClipboardAttach();

    const suggestions = this.currentSuggestions();

    if (this.hasNavigated && suggestions.length > 0) {
      const suggestion = suggestions[this.selectedIndex] ?? suggestions[0];

      if (suggestion) {
        this.applySuggestion(suggestion, true);
        return;
      }
    }

    this.submitValue();
  }

  private onData = (key: string): void => {
    if (!key) {
      return;
    }

    if (key === "\u001b" && this.onAbortStream) {
      this.onAbortStream();
      return;
    }

    if (this.inBracketedPaste) {
      this.pasteBuffer += key;

      const endIndex = this.pasteBuffer.indexOf(BRACKETED_PASTE_END);

      if (endIndex >= 0) {
        const pasted = this.pasteBuffer.slice(0, endIndex);
        this.finishBracketedPaste(pasted);
      }

      return;
    }

    if (key.includes(BRACKETED_PASTE_START)) {
      this.stopBlink();
      const startIndex = key.indexOf(BRACKETED_PASTE_START);
      const before = key.slice(0, startIndex);

      if (before) {
        this.value += before;
      }

      this.inBracketedPaste = true;
      this.pasteBuffer = key.slice(startIndex + BRACKETED_PASTE_START.length);

      const endIndex = this.pasteBuffer.indexOf(BRACKETED_PASTE_END);

      if (endIndex >= 0) {
        const pasted = this.pasteBuffer.slice(0, endIndex);
        this.finishBracketedPaste(pasted);
      }

      return;
    }

    if (key === "\u0003") {
      this.onCancel();
      return;
    }

    if (key === "\u0004" && this.value.length === 0) {
      this.onCancel();
      return;
    }

    if (key === "\r" || key === "\n") {
      void this.submit();
      return;
    }

    if (key === "\u001b[A") {
      const suggestions = this.currentSuggestions();

      if (suggestions.length > 0) {
        this.hasNavigated = true;
        this.selectedIndex = (this.selectedIndex - 1 + suggestions.length) % suggestions.length;
        this.render();
      }

      return;
    }

    if (key === "\u001b[B") {
      const suggestions = this.currentSuggestions();

      if (suggestions.length > 0) {
        this.hasNavigated = true;
        this.selectedIndex = (this.selectedIndex + 1) % suggestions.length;
        this.render();
      }

      return;
    }

    if (key === "\t") {
      const suggestions = this.currentSuggestions();
      const suggestion = suggestions[this.selectedIndex] ?? suggestions[0];

      if (suggestion) {
        this.applySuggestion(suggestion);
      }

      return;
    }

    if (key === "\u0016") {
      this.queueClipboardAttach();
      return;
    }

    if (key === "\u007f" || key === "\b") {
      if (this.value.length > 0) {
        this.value = this.value.slice(0, -1);
      } else if (this.attachedImages.length > 0) {
        this.attachedImages.pop();
      }

      this.resetSelection();
      this.cursorVisible = true;
      this.render();
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

      this.stopBlink();
      this.value += normalizePastedText(printable);
      this.resetSelection();
      this.cursorVisible = true;
      this.render();
      this.startBlink();
      return;
    }

    if (key.length === 1 && key >= " ") {
      this.value += key;
      this.resetSelection();
      this.cursorVisible = true;
      this.render();
    }
  };
}
