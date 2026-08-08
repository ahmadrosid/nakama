import {
  plainLine,
  type StyledLine,
  serializeStyledLine,
  styledLineWidth,
} from "./styled-text";

export interface FrameModel {
  cursor: {
    row: number;
    col: number;
    visible: boolean;
  };
  lines: StyledLine[];
  scrollBottom: number;
  scrollTop: number;
  topRow: number;
}

export type DiffOp =
  | { kind: "set_scroll_region"; top: number; bottom: number }
  | { kind: "set_cursor_visibility"; visible: boolean }
  | { kind: "scroll_up"; top: number; bottom: number; lines: number }
  | { kind: "write_line"; row: number; line: StyledLine }
  | { kind: "set_cursor"; row: number; col: number };

function lineKey(line: StyledLine | undefined): string {
  return line ? serializeStyledLine(line) : "";
}

function canScrollUpOne(previous: FrameModel, next: FrameModel): boolean {
  if (
    previous.topRow !== next.topRow ||
    previous.scrollTop !== next.scrollTop ||
    previous.scrollBottom !== next.scrollBottom
  ) {
    return false;
  }

  const start = next.scrollTop - next.topRow;
  const end = next.scrollBottom - next.topRow;

  if (start < 0 || end < start || end + 1 >= next.lines.length) {
    return false;
  }

  // When the last line of the scroll region is unchanged between frames,
  // it's a pinned line (status line, debug line, etc.) — exclude it from
  // the scroll comparison so content above it can use the scroll_up
  // optimization.
  const hasPinnedBottom =
    lineKey(next.lines[end]) === lineKey(previous.lines[end]);
  const limit = hasPinnedBottom ? end - 1 : end;

  if (limit <= start) {
    return false;
  }

  for (let index = start; index < limit; index += 1) {
    if (lineKey(next.lines[index]) !== lineKey(previous.lines[index + 1])) {
      return false;
    }
  }

  return true;
}

export function diffFrames(
  previous: FrameModel | null,
  next: FrameModel
): DiffOp[] {
  const operations: DiffOp[] = [];

  if (
    !previous ||
    previous.scrollTop !== next.scrollTop ||
    previous.scrollBottom !== next.scrollBottom
  ) {
    operations.push({
      bottom: next.scrollBottom,
      kind: "set_scroll_region",
      top: next.scrollTop,
    });
  }

  if (!previous || previous.cursor.visible !== next.cursor.visible) {
    operations.push({
      kind: "set_cursor_visibility",
      visible: next.cursor.visible,
    });
  }

  const handledRows = new Set<number>();

  if (previous && canScrollUpOne(previous, next)) {
    operations.push({
      bottom: next.scrollBottom,
      kind: "scroll_up",
      lines: 1,
      top: next.scrollTop,
    });

    const start = next.scrollTop - next.topRow;
    const end = next.scrollBottom - next.topRow;
    const hasPinnedBottom =
      lineKey(next.lines[end]) === lineKey(previous.lines[end]);
    const limit = hasPinnedBottom ? end - 1 : end;

    for (let index = start; index < limit; index += 1) {
      handledRows.add(index);
    }

    // When the scroll region has a pinned bottom line (e.g. status line), the
    // scroll_up operation shifts that line up by 1 along with everything else.
    // Re-write it at its intended position so it doesn't stay shifted up.
    if (hasPinnedBottom) {
      operations.push({
        kind: "write_line",
        line: next.lines[end],
        row: next.topRow + end,
      });
      handledRows.add(end);
    }
  }

  for (let index = 0; index < next.lines.length; index += 1) {
    if (handledRows.has(index)) {
      continue;
    }

    const nextLine = next.lines[index] ?? plainLine("");
    const previousLine = previous?.lines[index];
    const nextLineIsEmpty = lineKey(nextLine) === "";

    // Preserve existing terminal content outside active rows on the first paint.
    if (!previous && nextLineIsEmpty) {
      continue;
    }

    if (!previousLine || lineKey(previousLine) !== lineKey(nextLine)) {
      operations.push({
        kind: "write_line",
        line: nextLine,
        row: next.topRow + index,
      });
    }
  }

  operations.push({
    col: next.cursor.col,
    kind: "set_cursor",
    row: next.cursor.row,
  });

  return operations;
}

export function serializeDiffOps(operations: DiffOp[]): string {
  const chunks: string[] = [];

  for (const operation of operations) {
    if (operation.kind === "set_scroll_region") {
      chunks.push(`\x1b[${operation.top};${operation.bottom}r`);
      continue;
    }

    if (operation.kind === "set_cursor_visibility") {
      chunks.push(operation.visible ? "\x1b[?25h" : "\x1b[?25l");
      continue;
    }

    if (operation.kind === "scroll_up") {
      chunks.push(`\x1b[${operation.bottom};1H`);
      for (let index = 0; index < operation.lines; index += 1) {
        chunks.push("\n");
      }
      continue;
    }

    if (operation.kind === "write_line") {
      chunks.push(
        `\x1b[${operation.row};1H\x1b[K${serializeStyledLine(operation.line)}`
      );
      continue;
    }

    if (operation.kind === "set_cursor") {
      chunks.push(`\x1b[${operation.row};${operation.col}H`);
    }
  }

  return chunks.join("");
}

export function clampFrameCursor(
  frame: FrameModel,
  rows: number,
  columns: number
): FrameModel {
  const maxRow = Math.max(1, rows);
  const maxCol = Math.max(1, columns);
  const row = Math.min(maxRow, Math.max(1, frame.cursor.row));
  const col = Math.min(maxCol, Math.max(1, frame.cursor.col));

  return {
    ...frame,
    cursor: {
      ...frame.cursor,
      col,
      row,
    },
  };
}

export function cursorColFromLine(line: StyledLine, columns: number): number {
  const maxCol = Math.max(1, columns);
  return Math.min(maxCol, Math.max(1, styledLineWidth(line) + 1));
}
