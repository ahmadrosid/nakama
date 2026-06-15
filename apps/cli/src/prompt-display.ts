import { wrapText } from "./text-measure";

export function formatInputForDisplay(value: string): string {
  return normalizePastedText(value);
}

export function normalizePastedText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function splitInputDisplayLines(
  display: string,
  prefixLength: number,
  width: number,
): string[] {
  const terminalWidth = Math.max(1, width);
  const lineCapacity = Math.max(1, terminalWidth - prefixLength);
  const logicalLines = display.split("\n");
  const result: string[] = [];

  for (const logicalLine of logicalLines) {
    if (logicalLine.length === 0) {
      result.push("");
      continue;
    }

    const wrapped = wrapText(logicalLine, lineCapacity);
    result.push(...wrapped);
  }

  return result.length > 0 ? result : [""];
}
