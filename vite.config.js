import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the built site works from any sub-path —
  // GitHub Pages serves a project at https://<user>.github.io/<repo>/ and this
  // way the repository can be renamed without touching the config.
  base: "./",
  build: { outDir: "dist" },
});
