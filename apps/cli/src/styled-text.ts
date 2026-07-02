import { visibleLength } from "./text-measure";

export type NamedColor = "default" | "cyan" | "yellow" | "red" | "green";
export type NamedBackgroundColor = "surface";

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

const BACKGROUND_CODES: Record<NamedBackgroundColor, string> = {
  surface: "48;5;236",
};

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
    if (style?.background) codes.push(BACKGROUND_CODES[style.background]);

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
