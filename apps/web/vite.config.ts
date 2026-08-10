import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const serverUrl = process.env.nakama_SERVER_URL ?? "http://127.0.0.1:4310";

export default defineConfig({
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
    port: 3003,
    proxy: {
      "/health": serverUrl,
      "/v1": serverUrl,
    },
  },
});
