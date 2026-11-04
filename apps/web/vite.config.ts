import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

const serverUrl = process.env.NAKAMA_SERVER_URL ?? "http://127.0.0.1:4310";

const publicWebUrl =
  process.env.NAKAMA_WEB_PUBLIC_URL?.trim() ||
  process.env.NAKAMA_PUBLIC_URL?.trim();

let allowedHosts: string[] | undefined;
if (publicWebUrl) {
  try {
    const url = new URL(publicWebUrl);
    if (!(url.hostname && ["http:", "https:"].includes(url.protocol))) {
      throw new TypeError("Invalid public web URL");
    }
    allowedHosts = [url.hostname];
  } catch {
    console.warn(
      "Public web URL must be an absolute HTTP(S) URL; Vite will use its default allowed hosts."
    );
  }
}

export default defineConfig({
  // `scripts/build-sw.ts` reads the manifest to build the service worker's
  // precache list, then deletes it from `dist`.
  build: {
    manifest: true,
  },
  optimizeDeps: {
    // Workspace exports can change without a lockfile change. Refresh the
    // optimizer cache on startup so browsers don't reuse obsolete dep chunks.
    force: true,
    // Chat is lazy-loaded. Without this, first /chat visit discovers streamdown
    // mid-session, Vite rewrites dep chunks, and the browser 404s the old ones.
    include: [
      "@streamdown/cjk",
      "@streamdown/code",
      "@streamdown/math",
      "@streamdown/mermaid",
      "streamdown",
    ],
  },
  plugins: [react(), tailwindcss()],
  preview: {
    port: 3003,
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "@nakama/core/local-auth": path.resolve(
        root,
        "src/shims/core-local-auth.ts"
      ),
      "@nakama/core/runtime": path.resolve(root, "src/shims/core-runtime.ts"),
      "@nakama/core/thinking-content": path.resolve(
        root,
        "../../packages/core/src/thinking-content.ts"
      ),
      // Native N-API converter — server-only; keep the browser bundle free of .node binaries.
      [path.resolve(root, "../../packages/core/src/anydoc-text.ts")]:
        path.resolve(root, "src/shims/anydoc-text.ts"),
      "@firecrawl/anydoc": path.resolve(root, "src/shims/firecrawl-anydoc.ts"),
    },
  },
  server: {
    allowedHosts,
    port: 3003,
    proxy: {
      "/artifact-frame": serverUrl,
      "/health": serverUrl,
      "/v1": serverUrl,
    },
  },
});
