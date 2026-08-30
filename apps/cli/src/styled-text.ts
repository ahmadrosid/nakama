import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getUserConfigDir, readTextOrNull, writeTextFile } from "@nakama/core";
import { stripAnsi, visibleLength } from "./text-measure";

export type NamedColor = "default" | "cyan" | "yellow" | "red" | "green";
export type NamedBackgroundColor = "surface";
export type Theme = "dark" | "light";

export interface TextStyle {
  background?: NamedBackgroundColor;
  blink?: boolean;
  bold?: boolean;
  color?: NamedColor;
  dim?: boolean;
}

export interface StyledSegment {
  style?: TextStyle;
  text: string;
}

export interface StyledLine {
  segments: StyledSegment[];
}

/** Persistable CLI runtime hints under `~/.nakama/cli-state.json`. */
export interface CliState {
  macosTheme?: Theme;
  /** mtimeMs of `~/Library/Preferences/.GlobalPreferences.plist` when cached. */
  macosThemePrefsMtimeMs?: number;
}

export type DetectMacOsThemeOptions = {
  prefsMtimeMs?: () => number | null;
  readDefaults?: () => Theme;
};

const COLOR_CODES: Record<NamedColor, string> = {
  cyan: "36",
  default: "39",
  green: "32",
  red: "31",
  yellow: "33",
};

const BACKGROUND_CODES: Record<Theme, Record<NamedBackgroundColor, string>> = {
  dark: {
    surface: "48;5;236",
  },
  light: {
    surface: "48;5;254",
  },
};

const DEFAULTS_TIMEOUT_MS = 500;

let currentTheme: Theme = "dark";
let sessionMacOsTheme: Theme | undefined;

export function setTheme(theme: Theme): void {
  currentTheme = theme;
}

export function getCliStatePath(): string {
  return join(getUserConfigDir(), "cli-state.json");
}

export function clearMacOsThemeSessionCache(): void {
  sessionMacOsTheme = undefined;
}

function globalPreferencesPath(): string {
  return join(homedir(), "Library/Preferences/.GlobalPreferences.plist");
}

function readGlobalPreferencesMtimeMs(): number | null {
  try {
    return statSync(globalPreferencesPath()).mtimeMs;
  } catch {
    return null;
  }
}

function readMacOsThemeFromDefaults(): Theme {
  try {
    // execFile (no shell) + SIGKILL on timeout — avoids orphaned shell children
    execFileSync("defaults", ["read", "-g", "AppleInterfaceStyle"], {
      encoding: "utf8",
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: DEFAULTS_TIMEOUT_MS,
    });
    return "dark";
  } catch {
    return "light";
  }
}

async function loadCliState(): Promise<CliState> {
  const raw = await readTextOrNull(getCliStatePath());
  if (raw === null) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as CliState;
  } catch {
    return {};
  }
}

async function saveMacOsThemeCache(
  theme: Theme,
  prefsMtimeMs: number | null
): Promise<void> {
  const state = await loadCliState();
  state.macosTheme = theme;
  if (prefsMtimeMs == null) {
    delete state.macosThemePrefsMtimeMs;
  } else {
    state.macosThemePrefsMtimeMs = prefsMtimeMs;
  }
  await writeTextFile(getCliStatePath(), `${JSON.stringify(state)}\n`, {
    ensureDir: getUserConfigDir(),
  });
}

/**
 * macOS appearance via `defaults`, cached in cli-state.json keyed by
 * GlobalPreferences mtime so each CLI process does not re-fork.
 */
export async function detectMacOsTheme(
  options: DetectMacOsThemeOptions = {}
): Promise<Theme> {
  if (sessionMacOsTheme) {
    return sessionMacOsTheme;
  }

  const prefsMtimeMs = (options.prefsMtimeMs ?? readGlobalPreferencesMtimeMs)();
  const state = await loadCliState();
  const cached = state.macosTheme;
  if (
    (cached === "dark" || cached === "light") &&
    prefsMtimeMs != null &&
    state.macosThemePrefsMtimeMs === prefsMtimeMs
  ) {
    sessionMacOsTheme = cached;
    return cached;
  }

  const theme = (options.readDefaults ?? readMacOsThemeFromDefaults)();
  sessionMacOsTheme = theme;
  try {
    await saveMacOsThemeCache(theme, prefsMtimeMs);
  } catch {
    // Cache write is best-effort; theme detection must still succeed.
  }
  return theme;
}

export async function detectTheme(): Promise<Theme | null> {
  // macOS system appearance — most reliable for Apple terminals
  if (process.platform === "darwin") {
    return detectMacOsTheme();
  }

  // Many terminals set this: "0;15" = dark bg light fg, "15;0" = light bg dark fg
  const colorFgBg = process.env.COLORFGBG;
  if (colorFgBg) {
    const parts = colorFgBg.split(";");
    const fg = Number.parseInt(parts[0] ?? "", 10);
    const bg = Number.parseInt(parts[1] ?? "", 10);
    if (!(Number.isNaN(bg) || Number.isNaN(fg))) {
      return bg > fg ? "light" : "dark";
    }
  }

  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    return null;
  }

  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    const wasRaw = stdin.isRaw;
    let resolved = false;

    const finish = (result: Theme | null) => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timer);
      stdin.off("data", onData);
      if (!wasRaw) {
        stdin.pause();
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), 200);

    function onData(chunk: Buffer | string) {
      const response = String(chunk);
      const match = response.match(
        /\x1b\]1[01];(?:rgb:)?([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})/
      );
      if (!match) {
        return;
      }
      const r = Number.parseInt(match[1].slice(0, 2), 16);
      const g = Number.parseInt(match[2].slice(0, 2), 16);
      const b = Number.parseInt(match[3].slice(0, 2), 16);
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
        return;
      }
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      finish(luminance > 128 ? "light" : "dark");
    }

    if (!wasRaw) {
      stdin.resume();
    }
    stdin.on("data", onData);
    stdout.write("\x1b]11;?\x1b\\");
  });
}

export function plainLine(text: string): StyledLine {
  return { segments: [{ text }] };
}

export function styledLine(text: string, style?: TextStyle): StyledLine {
  return { segments: [{ style, text: stripAnsi(text) }] };
}

export function cloneStyledLine(line: StyledLine): StyledLine {
  return {
    segments: line.segments.map((segment) => ({
      style: segment.style ? { ...segment.style } : undefined,
      text: stripAnsi(segment.text),
    })),
  };
}

export function normalizeStyledLine(input: string | StyledLine): StyledLine {
  if (typeof input === "string") {
    return plainLine(stripAnsi(input));
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

    if (style?.bold) {
      codes.push("1");
    }
    if (style?.dim) {
      codes.push("2");
    }
    if (style?.blink) {
      codes.push("5");
    }
    if (style?.color) {
      codes.push(COLOR_CODES[style.color]);
    }
    if (style?.background) {
      codes.push(BACKGROUND_CODES[currentTheme][style.background]);
    }

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
