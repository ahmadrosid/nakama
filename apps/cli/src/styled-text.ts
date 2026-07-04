import { visibleLength } from "./text-measure";

export type NamedColor = "default" | "cyan" | "yellow" | "red" | "green";
export type NamedBackgroundColor = "surface";
export type Theme = "dark" | "light";

export interface TextStyle {
  bold?: boolean;
  dim?: boolean;
  blink?: boolean;
  color?: NamedColor;
  background?: NamedBackgroundColor;
}

export interface StyledSegment {
  text: string;
  style?: TextStyle;
}

export interface StyledLine {
  segments: StyledSegment[];
}

const COLOR_CODES: Record<NamedColor, string> = {
  default: "39",
  cyan: "36",
  yellow: "33",
  red: "31",
  green: "32",
};

const BACKGROUND_CODES: Record<Theme, Record<NamedBackgroundColor, string>> = {
  dark: {
    surface: "48;5;236",
  },
  light: {
    surface: "48;5;251",
  },
};

let currentTheme: Theme = "dark";

export function setTheme(theme: Theme): void {
  currentTheme = theme;
}

export function getTheme(): Theme {
  return currentTheme;
}

export async function detectTheme(): Promise<Theme | null> {
  // Many terminals set this: "0;15" = dark bg light fg, "15;0" = light bg dark fg
  const colorFgBg = process.env.COLORFGBG;
  if (colorFgBg) {
    const parts = colorFgBg.split(";");
    const fg = parseInt(parts[0] ?? "", 10);
    const bg = parseInt(parts[1] ?? "", 10);
    if (!Number.isNaN(bg) && !Number.isNaN(fg)) {
      return bg > fg ? "light" : "dark";
    }
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;

  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    const wasRaw = stdin.isRaw;
    let resolved = false;

    const finish = (result: Theme | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      stdin.off("data", onData);
      if (!wasRaw) stdin.pause();
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), 200);

    function onData(chunk: Buffer | string) {
      const response = String(chunk);
      const match = response.match(/\x1b\]1[01];(?:rgb:)?([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})/);
      if (!match) return;
      const r = parseInt(match[1].slice(0, 2), 16);
      const g = parseInt(match[2].slice(0, 2), 16);
      const b = parseInt(match[3].slice(0, 2), 16);
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return;
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      finish(luminance > 128 ? "light" : "dark");
    }

    if (!wasRaw) stdin.resume();
    stdin.on("data", onData);
    stdout.write("\x1b]11;?\x1b\\");
  });
}

export function plainLine(text: string): StyledLine {
  return { segments: [{ text }] };
}

export function styledLine(text: string, style?: TextStyle): StyledLine {
  return { segments: [{ text, style }] };
}

export function cloneStyledLine(line: StyledLine): StyledLine {
  return {
    segments: line.segments.map((segment) => ({
      text: segment.text,
      style: segment.style ? { ...segment.style } : undefined,
    })),
  };
}

export function normalizeStyledLine(input: string | StyledLine): StyledLine {
  if (typeof input === "string") {
    return plainLine(input);
  }

  return cloneStyledLine(input);
}

export function styledLineText(line: StyledLine): string {
  return line.segments.map((segment) => segment.text).join("");
}

export function styledLineWidth(line: StyledLine): number {
  return visibleLength(styledLineText(line));
}

export function serializeStyledLine(line: StyledLine): string {
  const chunks: string[] = [];
  let styled = false;

  for (const segment of line.segments) {
    const style = segment.style;
    const codes: string[] = [];

    if (style?.bold) codes.push("1");
    if (style?.dim) codes.push("2");
    if (style?.blink) codes.push("5");
    if (style?.color) codes.push(COLOR_CODES[style.color]);
    if (style?.background) codes.push(BACKGROUND_CODES[currentTheme][style.background]);

    if (codes.length > 0) {
      chunks.push(`\x1b[${codes.join(";")}m${segment.text}`);
      styled = true;
    } else {
      chunks.push(segment.text);
    }
  }

  if (styled) {
    chunks.push("\x1b[0m");
  }

  return chunks.join("");
}
