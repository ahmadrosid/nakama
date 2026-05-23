import { join } from "node:path";

const DOCS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TinyClaw API</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>
      Scalar.createApiReference("#app", {
        url: "/openapi.json",
        theme: "default",
      });
    </script>
  </body>
</html>
`;

const serverRoot = join(import.meta.dir, "..");
const openApiPath = join(serverRoot, "openapi.json");
const port = parsePort(process.env.TINYCLAW_DOCS_PORT ?? "4320");
const host = process.env.TINYCLAW_DOCS_HOST ?? "127.0.0.1";

Bun.serve({
  hostname: host,
  port,
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (
      pathname === "/" ||
      pathname === "/docs" ||
      pathname === "/docs/"
    ) {
      return new Response(DOCS_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (pathname === "/openapi.json") {
      return new Response(Bun.file(openApiPath), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`TinyClaw API docs: http://${host}:${port}/`);
console.log("Spec: openapi.json (refresh after bun run openapi:generate)");

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);

  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid docs port: ${value}`);
  }

  return port;
}
