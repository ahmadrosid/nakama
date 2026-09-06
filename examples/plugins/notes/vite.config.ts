import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    assetsDir: "assets",
    emptyOutDir: true,
    outDir: "../ui",
  },
  plugins: [react()],
  root: "ui-src",
});
