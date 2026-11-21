// `bun check`: TypeScript 7 (the pinned Bun canary) over the root project and
// apps/web, which has its own tsconfig. typecheck-baseline.txt lists the errors
// that were there when this check started. A new error fails, and so does a
// listed error that is gone: delete its line, so the list only shrinks.
// `bun check --update` rewrites the list; use it only to remove lines.
import { spawnSync } from "node:child_process";
import { canaryBin } from "./bun-canary";

const BASELINE = "typecheck-baseline.txt";

const PROJECTS = [".", "apps/web"];

// "path(line,col): error TS1234: message" -> "path: TS1234". Line numbers move
// with every edit, and TypeScript 7 checks in parallel, so the order it prints
// union members in can change between runs: neither is part of the key. A count
// per key still catches a second error of the same code in the same file.
const ERROR_LINE = /^(.+?)\(\d+,\d+\): error (TS\d+): /;

function typeErrors(): string[] {
  const errors: string[] = [];

  for (const project of PROJECTS) {
    const before = errors.length;

    const result = spawnSync(
      canaryBin(),
      ["check", "--no-script", "--no-pretty", "--all", "-p", project],
      { encoding: "utf8" }
    );

    if (result.error) {
      throw result.error;
    }

    const output = `${result.stdout}${result.stderr}`;

    for (const line of output.split("\n")) {
      const match = ERROR_LINE.exec(line);

      if (match) {
        errors.push(`${match[1]}: ${match[2]}`);
      }
    }

    // A crash or a config error prints no error lines but still fails.
    if (result.status !== 0 && errors.length === before) {
      process.stderr.write(output);
      process.exit(result.status ?? 1);
    }
  }

  return errors.sort();
}

function countByKey(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  return counts;
}

const errors = typeErrors();

if (process.argv.includes("--update")) {
  await Bun.write(BASELINE, errors.length ? `${errors.join("\n")}\n` : "");
  console.log(`${BASELINE}: ${errors.length} errors`);
  process.exit(0);
}

const baselineFile = Bun.file(BASELINE);

const baseline = (await baselineFile.exists())
  ? (await baselineFile.text()).split("\n").filter(Boolean)
  : [];

const known = countByKey(baseline);

const found = countByKey(errors);

const added: string[] = [];

const gone: string[] = [];

for (const [key, count] of found) {
  for (let extra = count - (known.get(key) ?? 0); extra > 0; extra -= 1) {
    added.push(key);
  }
}

for (const [key, count] of known) {
  for (let fixed = count - (found.get(key) ?? 0); fixed > 0; fixed -= 1) {
    gone.push(key);
  }
}

if (added.length) {
  console.error(`New type errors (${added.length}):\n${added.join("\n")}`);
}

if (gone.length) {
  console.error(
    `Fixed, so delete these lines from ${BASELINE} (${gone.length}):\n${gone.join("\n")}`
  );
}

if (added.length || gone.length) {
  process.exit(1);
}

console.log(`No new type errors. ${baseline.length} known in ${BASELINE}.`);
