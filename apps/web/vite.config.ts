import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const serverUrl = process.env.TINYCLAW_SERVER_URL ?? "http://127.0.0.1:4310";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "@tinyclaw/core/runtime": path.resolve(root, "src/shims/core-runtime.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/health": serverUrl,
      "/v1": serverUrl,
    },
  },
});
