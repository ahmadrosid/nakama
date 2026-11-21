// Temporary: measures what is slow on the Windows runner. Not for merge.
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function time(label: string, runs: number, fn: (i: number) => void) {
  const start = performance.now();

  for (let i = 0; i < runs; i += 1) {
    fn(i);
  }

  const ms = performance.now() - start;
  console.log(
    `${label.padEnd(48)} ${(ms / runs).toFixed(2).padStart(8)} ms each (${runs} runs)`
  );
}

const dirs = Object.fromEntries(
  (process.argv.slice(2).length
    ? process.argv.slice(2)
    : [process.env.TEMP ?? "."]
  ).map((d) => [d, d])
);

for (const base of Object.keys(dirs)) {
  console.log(`\n== ${base}`);
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, "bench-"));

  for (const [name, pragma] of [
    ["sqlite default (delete journal, sync FULL)", ""],
    [
      "sqlite WAL + sync FULL",
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
    ],
    [
      "sqlite WAL + sync EXTRA",
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=EXTRA;",
    ],
    [
      "sqlite WAL + sync NORMAL",
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
    ],
    ["sqlite sync OFF", "PRAGMA synchronous=OFF;"],
  ] as const) {
    const db = new Database(join(root, `${name.replace(/\W+/g, "_")}.sqlite`));

    if (pragma) {
      db.exec(pragma);
    }

    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    const insert = db.prepare("INSERT INTO t (v) VALUES (?)");
    time(`${name}: autocommit insert`, 50, (i) => insert.run(`row ${i}`));
    db.close();
  }

  time("sqlite open + 10-table schema + close", 20, (i) => {
    const db = new Database(join(root, `schema-${i}.sqlite`));

    for (let t = 0; t < 10; t += 1) {
      db.exec(
        `CREATE TABLE IF NOT EXISTS t${t} (id INTEGER PRIMARY KEY, v TEXT)`
      );
    }

    db.close();
  });
  time("mkdtemp + 20 files + rm -r", 30, () => {
    const dir = mkdtempSync(join(root, "d-"));

    for (let f = 0; f < 20; f += 1) {
      writeFileSync(join(dir, `f${f}.txt`), "x".repeat(1000));
    }

    rmSync(dir, { recursive: true, force: true });
  });
  rmSync(root, { recursive: true, force: true });
}

console.log("\n== processes");

for (const [label, cmd, args] of [
  ["bun -e 0", process.execPath, ["-e", "0"]],
  ["python -c pass", "python", ["-c", "pass"]],
  ["git --version", "git", ["--version"]],
  ["cmd /c exit", "cmd", ["/c", "exit"]],
] as const) {
  time(label, 10, () => {
    const r = spawnSync(cmd, [...args]);

    if (r.error) {
      throw r.error;
    }
  });
}
