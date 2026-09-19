import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// Built files are served by the FastAPI backend: index.html at "/" and
// everything else under "/static/". No Node needed at runtime.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: path.resolve(import.meta.dirname, "client"),
  base: "/static/",
  build: { outDir: path.resolve(import.meta.dirname, "out"), emptyOutDir: true },
});
