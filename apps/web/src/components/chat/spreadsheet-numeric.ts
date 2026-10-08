export function isSpreadsheetNumericCell(value: string): boolean {
  const trimmed = value.trim();

  return trimmed.length > 0 && /^-?\d[\d,]*(\.\d+)?%?$/.test(trimmed);
}
