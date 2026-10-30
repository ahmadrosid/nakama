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

let next = readdirSync(dir).filter((name) => name.endsWith(".jpg")).length;

Bun.serve({
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/frames") {
      const items = await request.json();

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
  port,
});

console.log(`frame server on http://127.0.0.1:${port}, saving to ${dir}`);
