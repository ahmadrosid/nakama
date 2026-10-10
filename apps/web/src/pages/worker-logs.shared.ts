export interface WorkerLogRow {
  level: string | null;
  message: string;
  time: string | null;
}

const TIMESTAMPED_LINE =
  /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z\s+([A-Z]+)\s+(.*)$/;

export function parseWorkerLog(content: string): WorkerLogRow[] {
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const match = TIMESTAMPED_LINE.exec(line);

      if (!match) {
        return { level: null, message: line, time: null };
      }

      return { level: match[2], message: match[3], time: match[1] };
    });
}

export function collapseRepeats(
  rows: WorkerLogRow[]
): (WorkerLogRow & { count: number })[] {
  const out: (WorkerLogRow & { count: number })[] = [];

  for (const row of rows) {
    const last = out.at(-1);

    if (
      last &&
      last.message === row.message &&
      last.level === row.level &&
      last.time === row.time
    ) {
      last.count += 1;
    } else {
      out.push({ ...row, count: 1 });
    }
  }

  return out;
}
