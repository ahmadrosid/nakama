export type SpreadsheetRows = string[][];

export function isSpreadsheetNumericCell(value: string): boolean {
  const trimmed = value.trim();

  return trimmed.length > 0 && /^-?\d[\d,]*(\.\d+)?%?$/.test(trimmed);
}

function delimiterForFilename(filename: string): string {
  return filename.toLowerCase().endsWith(".tsv") ? "\t" : ",";
}

function parseDelimitedSpreadsheet(
  content: string,
  delimiter: string
): SpreadsheetRows {
  const rows: SpreadsheetRows = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }

      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    cell += char;
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.length > 0 ? rows : [[""]];
}

function serializeDelimitedSpreadsheet(
  rows: SpreadsheetRows,
  delimiter: string
): string {
  return `${rows
    .map((row) =>
      row
        .map((value) => {
          const cell = String(value ?? "");

          if (!(cell.includes(delimiter) || /["\r\n]/.test(cell))) {
            return cell;
          }

          return `"${cell.replace(/"/g, '""')}"`;
        })
        .join(delimiter)
    )
    .join("\n")}\n`;
}

export function parseSpreadsheetText(
  filename: string,
  content: string
): SpreadsheetRows {
  return normalizeSpreadsheetRows(
    parseDelimitedSpreadsheet(content, delimiterForFilename(filename))
  );
}

export function serializeSpreadsheetText(
  filename: string,
  rows: SpreadsheetRows
): string {
  return serializeDelimitedSpreadsheet(
    normalizeSpreadsheetRows(rows),
    delimiterForFilename(filename)
  );
}

function normalizeSpreadsheetRows(rows: SpreadsheetRows): SpreadsheetRows {
  const width = Math.max(1, ...rows.map((row) => row.length));

  const normalized = rows.map((row) =>
    Array.from({ length: width }, (_, index) => row[index] ?? "")
  );

  return normalized.length > 0 ? normalized : [[""]];
}

// oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- The spreadsheet editor imports this public helper.
export function normalizeSpreadsheetShape(
  rows: SpreadsheetRows
): SpreadsheetRows {
  return normalizeSpreadsheetRows(rows);
}

/** 0 → A, 25 → Z, 26 → AA */
export function columnIndexToLetter(index: number): string {
  let n = index + 1;
  let result = "";

  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }

  return result;
}
