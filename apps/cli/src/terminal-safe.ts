import { stripAnsi } from "./text-measure";

/** Print one terminal line after stripping untrusted ANSI/control sequences. */
export function printLine(line: string): void {
  console.log(stripAnsi(line));
}
