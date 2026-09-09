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
const pending = new Map();
process.on("message", (message) => {
  if (message?.type !== "nakama-host-result") {
    return;
  }
  const call = pending.get(message.id);
  if (!call) {
    return;
  }
  pending.delete(message.id);
  if (message.error) {
    call.reject(new Error(message.error));
  } else {
    call.resolve(message.result);
  }
});
context.host = (request) =>
  new Promise((resolve, reject) => {
    if (!process.send) {
      reject(new Error("Plugin host capabilities are unavailable."));
      return;
    }
    const id = crypto.randomUUID();
    pending.set(id, { reject, resolve });
    process.send({ id, request, type: "nakama-host-request" }, (error) => {
      if (error) {
        pending.delete(id);
        reject(error);
      }
    });
  });
const mod = await import(pathToFileURL(modulePath).href);
const run = typeof mod.run === "function" ? mod.run : mod.default?.run;
if (typeof run !== "function") {
  console.error("Plugin module must export a run(input, context) function.");
  process.exit(1);
}

try {
  const result = await run(input, context);
  process.stdout.write(JSON.stringify(result));
} finally {
  if (process.connected) {
    process.disconnect();
  }
}
