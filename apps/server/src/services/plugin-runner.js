import { pathToFileURL } from "node:url";

const modulePath = process.argv[2];
if (!modulePath) {
  console.error("Missing plugin module path");
  process.exit(1);
}

let envelope;
try {
  envelope = JSON.parse((await Bun.stdin.text()) || "{}");
} catch {
  console.error("Malformed plugin envelope");
  process.exit(1);
}

if (
  envelope === null ||
  typeof envelope !== "object" ||
  !("input" in envelope) ||
  !("context" in envelope)
) {
  console.error("Plugin runner requires a { input, context } envelope");
  process.exit(1);
}

const { input, context } = envelope;
const mod = await import(pathToFileURL(modulePath).href);
const run = typeof mod.run === "function" ? mod.run : mod.default?.run;
if (typeof run !== "function") {
  console.error("Plugin module must export a run(input, context) function.");
  process.exit(1);
}

const result = await run(input, context);
process.stdout.write(JSON.stringify(result));
