import type { Theme } from "./styled-text";

export class InvalidThemeArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidThemeArgError";
  }
}

function assertThemeValue(value: string | undefined): Theme {
  if (value === "light" || value === "dark") {
    return value;
  }

  if (value === undefined || value.length === 0) {
    throw new InvalidThemeArgError(
      "Missing value for --theme. Use --theme light or --theme dark."
    );
  }

  throw new InvalidThemeArgError(
    `Invalid --theme value "${value}". Use light or dark.`
  );
}

export function parseThemeArg(argv = process.argv.slice(2)): Theme | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--theme") {
      return assertThemeValue(argv[index + 1]?.trim());
    }

    if (arg?.startsWith("--theme=")) {
      return assertThemeValue(arg.slice("--theme=".length).trim());
    }
  }

  return null;
}
