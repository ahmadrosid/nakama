/**
 * Static server for LLM cassette viewer.
 *
 *   bun run view:cassettes
 *   → http://localhost:8766/viewer.html
 */
const port = Number(process.env.CASSETTE_VIEWER_PORT ?? 8766);
const root = import.meta.dir;

function contentType(pathname: string): string {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

function resolvePath(pathname: string): string | null {
  const cleaned = pathname === "/" ? "/viewer.html" : pathname;
  const relative = cleaned.replace(/^\/+/, "");
  if (!relative || relative.includes("..") || relative.includes("\\")) {
    return null;
  }
  return `${root}/${relative}`;
}

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const filePath = resolvePath(url.pathname);

    if (!filePath) {
      return new Response("Not found", { status: 404 });
    }

    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(file, {
      headers: {
        "Content-Type": contentType(url.pathname === "/" ? "/viewer.html" : url.pathname),
        "Cache-Control": "no-store",
      },
    });
  },
});

const viewerUrl = `http://localhost:${server.port}/viewer.html`;
console.log(`Cassette viewer: ${viewerUrl}`);

if (process.platform === "darwin") {
  await Bun.$`open ${viewerUrl}`.quiet().nothrow();
} else if (process.platform === "linux") {
  await Bun.$`xdg-open ${viewerUrl}`.quiet().nothrow();
}
