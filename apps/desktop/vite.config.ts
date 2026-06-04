import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  // Electron loads the packaged renderer with loadFile() (file:// origin),
  // so assets must use relative URLs ("./assets/…"). The default base of "/"
  // resolves to the filesystem root under file:// and 404s the JS/CSS bundle.
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "dist-electron/**", "node_modules/**", "release/**"]
  }
});
