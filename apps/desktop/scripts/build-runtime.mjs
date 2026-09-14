import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = join(root, "apps/desktop/dist/runtime");
if (
  !(
    (process.platform === "darwin" && process.arch === "arm64") ||
    (process.platform === "win32" && process.arch === "x64")
  )
) {
  throw new Error("Build the desktop runtime on macOS ARM64 or Windows x64.");
}
const web = Bun.spawn(
  [process.execPath, "run", "--filter", "@nakama/web", "build"],
  { cwd: root, stderr: "inherit", stdout: "inherit" }
);
if ((await web.exited) !== 0) {
  throw new Error("Web build failed");
}
await rm(output, { force: true, recursive: true });
await mkdir(join(output, "bin"), { recursive: true });
await cp(
  process.execPath,
  join(output, "bin", process.platform === "win32" ? "bun.exe" : "bun")
);
for (const name of ["package.json", "bun.lock"]) {
  await cp(join(root, name), join(output, name));
}
await mkdir(join(output, "patches"), { recursive: true });
await cp(
  join(root, "patches/@electron%2Fosx-sign@1.3.3.patch"),
  join(output, "patches/@electron%2Fosx-sign@1.3.3.patch")
);
// Only tracked runtime files: never package local .env files or development databases.
const tracked = Bun.spawnSync(
  [
    "git",
    "ls-files",
    "-z",
    "apps/server",
    "apps/platform",
    "packages",
    "patches",
  ],
  { cwd: root }
);
if (tracked.exitCode !== 0) {
  throw new Error("Build from a Git checkout of Nakama");
}
for (const file of tracked.stdout.toString().split("\0").filter(Boolean)) {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) {
    continue;
  }
  await mkdir(dirname(join(output, file)), { recursive: true });
  await cp(join(root, file), join(output, file));
}
// Keep every workspace manifest so the frozen lockfile stays valid.
for (const name of await readdir(join(root, "apps"))) {
  const manifest = join(root, "apps", name, "package.json");
  if (await Bun.file(manifest).exists()) {
    await mkdir(join(output, "apps", name), { recursive: true });
    await cp(manifest, join(output, "apps", name, "package.json"));
  }
}
await cp(join(root, "apps/web/dist"), join(output, "apps/web/dist"), {
  recursive: true,
});
const install = Bun.spawn(
  [
    process.execPath,
    "install",
    "--frozen-lockfile",
    "--production",
    "--ignore-scripts",
    ...["server", "automation", "telegram", "whatsapp", "discord"].flatMap(
      (name) => ["--filter", `@nakama/${name}`]
    ),
  ],
  { cwd: output, stderr: "inherit", stdout: "inherit" }
);
if ((await install.exited) !== 0) {
  throw new Error("Runtime dependency installation failed");
}
console.log(`Desktop runtime ready: ${resolve(output)}`);
