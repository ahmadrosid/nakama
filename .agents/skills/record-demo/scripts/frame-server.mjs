// Saves JPEG frames that a BrowserOS relay tab posts, and logs each frame's capture time.
// Usage: bun frame-server.mjs <frames-dir> [port]
import { appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const port = Number(process.argv[3] ?? 4399);

if (!dir) {
  console.error("Usage: bun frame-server.mjs <frames-dir> [port]");
  process.exit(1);
}

mkdirSync(dir, { recursive: true });

const host = `127.0.0.1:${port}`;
const origin = `http://${host}`;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

let next = readdirSync(dir).filter((name) => name.endsWith(".jpg")).length;

// Only the relay tab may post: same host (no DNS rebinding), same origin, and a
// custom header that a cross-site no-cors request cannot send.
function isRelayRequest(request) {
  const headers = request.headers;
  const requestOrigin = headers.get("origin");

  return (
    headers.get("host") === host &&
    (requestOrigin === null || requestOrigin === origin) &&
    headers.get("x-frame-relay") === "1"
  );
}

function isFrame(item) {
  return (
    Number.isSafeInteger(item?.t) &&
    item.t > 0 &&
    typeof item.d === "string" &&
    BASE64.test(item.d)
  );
}

Bun.serve({
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/frames") {
      if (!isRelayRequest(request)) {
        return new Response("forbidden", { status: 403 });
      }

      const body = await request.text();

      if (body.length > MAX_BODY_BYTES) {
        return new Response("too large", { status: 413 });
      }

      let items;

      try {
        items = JSON.parse(body);
      } catch {
        return new Response("bad json", { status: 400 });
      }

      if (!(Array.isArray(items) && items.every(isFrame))) {
        return new Response("bad frames", { status: 400 });
      }

      for (const item of items) {
        const name = `f${String(next).padStart(6, "0")}.jpg`;

        next += 1;
        await Bun.write(join(dir, name), Buffer.from(item.d, "base64"));
        appendFileSync(join(dir, "index.txt"), `${name} ${item.t}\n`);
      }

      return new Response("ok");
    }

    return new Response("<title>relay</title>relay", {
      headers: { "content-type": "text/html" },
    });
  },
  hostname: "127.0.0.1",
  maxRequestBodySize: MAX_BODY_BYTES,
  port,
});

console.log(`frame server on ${origin}, saving to ${dir}`);
