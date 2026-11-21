// Runs the Bun canary that package.json pins: `bun lint`, `bun fmt` and
// `bun check` ship only in canaries so far. Each platform package carries the
// binary itself, so the installed Bun keeps running every other script.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

const platform = process.platform === "win32" ? "windows" : process.platform;

const arch = process.arch === "arm64" ? "aarch64" : "x64";

const manifest = Bun.resolveSync(
  `@oven/bun-${platform}-${arch}/package.json`,
  import.meta.dir
);

const bin = join(
  dirname(manifest),
  "bin",
  platform === "windows" ? "bun.exe" : "bun"
);

const [command, ...args] = process.argv.slice(2);

// --no-script: the root package.json maps `lint` and `fmt` to this file.
const result = spawnSync(bin, [command, "--no-script", ...args], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
