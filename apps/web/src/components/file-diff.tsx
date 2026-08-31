/**
 * Adapted from AIcss File Diff (https://www.aicss.dev/components/file-diff).
 * Production use requires a valid AIcss license per https://www.aicss.dev/pricing
 */
import { cn } from "@/lib/utils";
import styles from "./file-diff.module.css";
import type { FileDiffRow } from "./file-diff.shared";

export { buildFileDiffRows } from "./file-diff.shared";

export function FileDiff({
  className,
  rows,
}: {
  className?: string;
  rows: FileDiffRow[];
}) {
  return (
    <div className={cn(styles.diff, className)}>
      {rows.length === 0 ? (
        <p className={styles.diffEmpty}>No line changes.</p>
      ) : (
        <div className={styles.diffLines}>
          {rows.map((row) => (
            <div
              className={cn(styles.diffRow, styles[row.type])}
              key={`${row.type}-${row.old ?? "x"}-${row.cur ?? "x"}`}
            >
              <span className={cn(styles.ln, styles.old)}>{row.old ?? ""}</span>
              <span className={cn(styles.ln, styles.new)}>{row.cur ?? ""}</span>
              <span className={styles.sign}>
                {row.type === "add" ? "+" : row.type === "del" ? "-" : ""}
              </span>
              <code>{row.text}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
