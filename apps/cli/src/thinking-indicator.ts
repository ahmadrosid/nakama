import type { StatusRenderer } from "./terminal-renderer";
import { serializeStyledLine, styledLine, type StyledLine } from "./styled-text";

const THINKING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const FRAME_INTERVAL_MS = 80;

export function formatThinkingIndicator(frameIndex: number): StyledLine {
  const frame = THINKING_FRAMES[frameIndex % THINKING_FRAMES.length] ?? THINKING_FRAMES[0];
  return styledLine(` ${frame} Thinking `, { dim: true });
}

export class ThinkingIndicator {
  private active = false;
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private renderer: StatusRenderer | null = null;
  private lineStarted = false;

  setRenderer(renderer: StatusRenderer | null): void {
    this.renderer = renderer;
  }

  isActive(): boolean {
    return this.active;
  }

  start(): void {
    if (this.active) {
      return;
    }

    this.active = true;
    this.frame = 0;
    this.lineStarted = false;
    this.render();
    this.timer = setInterval(() => {
      this.frame += 1;
      this.render();
    }, FRAME_INTERVAL_MS);
  }

  stop(): void {
    if (!this.active) {
      return;
    }

    this.active = false;
    this.lineStarted = false;
    this.renderer?.setStatusLine(null);

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private render(): void {
    const content = formatThinkingIndicator(this.frame);

    if (this.renderer?.isEnabled()) {
      this.renderer.setStatusLine(content);
      this.lineStarted = true;
      return;
    }

    if (!this.lineStarted) {
      process.stdout.write("\x1b[?25l\n");
      this.lineStarted = true;
    }

    process.stdout.write(`\r\x1b[K${serializeStyledLine(content)}`);
  }
}
