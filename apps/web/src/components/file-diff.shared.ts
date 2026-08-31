export type FileDiffRow = {
  cur: number | null;
  old: number | null;
  text: string;
  type: "ctx" | "add" | "del";
};

type DiffOp =
  | { cur: number; old: number; text: string; type: "ctx" }
  | { old: number; text: string; type: "del" }
  | { cur: number; text: string; type: "add" };

const CONTEXT_LINES = 3;
const LCS_CELL_CAP = 250_000;

function splitLines(value: string | null): string[] {
  if (value == null || value === "") {
    return [];
  }
  return value.split(/\r?\n/);
}

function replaceAll(oldLines: string[], newLines: string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  for (const [index, text] of oldLines.entries()) {
    ops.push({ old: index + 1, text, type: "del" });
  }
  for (const [index, text] of newLines.entries()) {
    ops.push({ cur: index + 1, text, type: "add" });
  }
  return ops;
}

function diffLines(oldLines: string[], newLines: string[]): DiffOp[] {
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  if (oldCount * newCount > LCS_CELL_CAP) {
    return replaceAll(oldLines, newLines);
  }

  const lcs: number[][] = Array.from({ length: oldCount + 1 }, () =>
    Array.from({ length: newCount + 1 }, () => 0)
  );
  for (let oldIndex = oldCount - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newCount - 1; newIndex >= 0; newIndex--) {
      lcs[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? lcs[oldIndex + 1][newIndex + 1] + 1
          : Math.max(lcs[oldIndex + 1][newIndex], lcs[oldIndex][newIndex + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldCount && newIndex < newCount) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      ops.push({
        cur: newIndex + 1,
        old: oldIndex + 1,
        text: oldLines[oldIndex],
        type: "ctx",
      });
      oldIndex += 1;
      newIndex += 1;
      continue;
    }
    if (lcs[oldIndex + 1][newIndex] >= lcs[oldIndex][newIndex + 1]) {
      ops.push({
        old: oldIndex + 1,
        text: oldLines[oldIndex],
        type: "del",
      });
      oldIndex += 1;
      continue;
    }
    ops.push({
      cur: newIndex + 1,
      text: newLines[newIndex],
      type: "add",
    });
    newIndex += 1;
  }
  while (oldIndex < oldCount) {
    ops.push({
      old: oldIndex + 1,
      text: oldLines[oldIndex],
      type: "del",
    });
    oldIndex += 1;
  }
  while (newIndex < newCount) {
    ops.push({
      cur: newIndex + 1,
      text: newLines[newIndex],
      type: "add",
    });
    newIndex += 1;
  }
  return ops;
}

function withContext(ops: DiffOp[], context: number): FileDiffRow[] {
  if (ops.length === 0) {
    return [];
  }

  const keep = new Set<number>();
  for (const [index, op] of ops.entries()) {
    if (op.type === "ctx") {
      continue;
    }
    const from = Math.max(0, index - context);
    const to = Math.min(ops.length - 1, index + context);
    for (let nearby = from; nearby <= to; nearby++) {
      keep.add(nearby);
    }
  }

  if (keep.size === 0) {
    return [];
  }

  return ops.flatMap((op, index) => {
    if (!keep.has(index)) {
      return [];
    }
    return [
      {
        cur: op.type === "del" ? null : op.cur,
        old: op.type === "add" ? null : op.old,
        text: op.text,
        type: op.type,
      },
    ];
  });
}

export function buildFileDiffRows(
  before: string | null,
  after: string | null
): FileDiffRow[] {
  return withContext(
    diffLines(splitLines(before), splitLines(after)),
    CONTEXT_LINES
  );
}
