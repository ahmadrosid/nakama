/**
 * Pre-commit check: staged files must stay under 5,000 tokens (bytes / 4).
 * Files that agents do not write by hand (lockfiles, codegen, cassettes,
 * binaries) are skipped.
 *
 *   bun run scripts/check-file-size.ts
 */

const MAX_TOKENS = 5000;

const BYTES_PER_TOKEN = 4;

const IGNORED_PATHS = [
  /(^|\/)(bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|uv\.lock|poetry\.lock)$/,
  /\.lock$/,
  /(^|\/)(generated|__generated__|cassettes|patches|node_modules|dist)\//,
  /\.(generated|gen|min)\.[a-z]+$/,
  /\.(snap|svg|map|pdf|png|jpe?g|gif|webp|ico|icns|mp4|mov|woff2?|ttf|otf|zip|gz)$/i,
  /(^|\/)CHANGELOG\.md$/,
];

const git = (args: string[]) =>
  Bun.spawnSync(["git", ...args], { stderr: "pipe", stdout: "pipe" });

const staged = git([
  "diff",
  "--cached",
  "--name-only",
  "--diff-filter=ACMR",
  "-z",
])
  .stdout.toString()
  .split("\0")
  .filter(Boolean);

const tooBig: { file: string; tokens: number }[] = [];

for (const file of staged) {
  if (IGNORED_PATHS.some((pattern) => pattern.test(file))) {
    continue;
  }

  const bytes = Number(git(["cat-file", "-s", `:${file}`]).stdout.toString());
  const tokens = Math.ceil(bytes / BYTES_PER_TOKEN);

  if (tokens > MAX_TOKENS) {
    tooBig.push({ file, tokens });
  }
}

if (tooBig.length === 0) {
  process.exit(0);
}

const list = tooBig
  .map(({ file, tokens }) => `  - ${file} (~${tokens} tokens)`)
  .join("\n");

console.error(`
Commit blocked: ${tooBig.length} staged file(s) are over ${MAX_TOKENS} tokens (bytes / ${BYTES_PER_TOKEN}).

${list}

Big files are hard for agents to read and edit. Split each one:

  1. Read the file. Find 2-4 parts that each do one job
     (for example: types, helpers, one feature, one route group).
  2. Create a new file next to it for each part. Name it for its job,
     for example "chat-prompt-tools.ts". Do not use "part2" or "utils".
  3. Move the code to the new files. Do not rewrite it.
  4. Keep the old file as the entry point. Import from the new files and
     re-export only what other files already import, so callers do not change.
  5. Tests, MDX, and Markdown: split by describe block or by heading into
     files of the same kind.
  6. Run "bun x tsc --noEmit" and "bun test" for the touched package.
  7. Run "git add" on the new files and the old file. Commit again.

Do not bypass this check with "--no-verify". If a file is not agent-written
(codegen, fixtures, data), add its path to IGNORED_PATHS in
scripts/check-file-size.ts.
`);

process.exit(1);
