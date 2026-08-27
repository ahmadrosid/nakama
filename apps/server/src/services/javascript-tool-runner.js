import { pathToFileURL } from "node:url";

const modulePath = process.argv[2];
if (!modulePath) {
  console.error("Missing tool module path");
  process.exit(1);
}

const mod = await import(pathToFileURL(modulePath).href);
const run = typeof mod.run === "function" ? mod.run : mod.default?.run;
if (typeof run !== "function") {
  console.error("Tool module must export a run(input, context) function.");
  process.exit(1);
}

const payload = JSON.parse((await Bun.stdin.text()) || "{}");
const result = await run(payload, {
  workspaceRoot: process.env.NAKAMA_WORKSPACE_ROOT,
});
process.stdout.write(JSON.stringify(result));
