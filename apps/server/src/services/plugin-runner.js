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
  !(envelope instanceof Object) ||
  !("input" in envelope) ||
  !("context" in envelope)
) {
  console.error("Plugin runner requires a { input, context } envelope");
  process.exit(1);
}

const { input, context } = envelope;

const pending = new Map();

// Host failures keep their 500 path even when the action rethrows them.
const hostErrors = new WeakSet();

const hostError = (message) => {
  const error = new Error(message);
  hostErrors.add(error);

  return error;
};

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
    call.reject(hostError(message.error));
  } else {
    call.resolve(message.result);
  }
});

context.host = (request) =>
  new Promise((resolve, reject) => {
    if (!process.send) {
      reject(hostError("Plugin host capabilities are unavailable."));

      return;
    }

    const id = crypto.randomUUID();
    pending.set(id, { reject, resolve });
    process.send({ id, request, type: "nakama-host-request" }, (error) => {
      if (error) {
        pending.delete(id);
        hostErrors.add(error);
        reject(error);
      }
    });
  });

const mod = await import(pathToFileURL(modulePath).href);

const run = mod.run ?? mod.default?.run;

if (!(run instanceof Function)) {
  console.error("Plugin module must export a run(input, context) function.");
  process.exit(1);
}

try {
  let output;

  try {
    output = { ok: true, result: await run(input, context) };
  } catch (error) {
    if (!(error instanceof Error) || hostErrors.has(error)) {
      throw error;
    }

    // Only the message crosses the boundary; the stack stays in the child.
    output = { error: error.message, ok: false };
  }

  process.stdout.write(JSON.stringify(output));
} finally {
  if (process.connected) {
    process.disconnect();
  }
}
