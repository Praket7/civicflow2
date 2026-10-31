import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
// @ts-expect-error - local Vite plugin is plain ESM without type declarations
import i18nPlugin from "./scripts/i18n-vite-plugin.mjs";

// Tauri expects a fixed port and must not watch the Rust tree.
export default defineConfig({
  plugins: [i18nPlugin(), react()],
  resolve: {
    alias: {
      "@i18n": fileURLToPath(new URL("./src/lib/i18n/index.tsx", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: ["es2021", "chrome100", "safari15"],
    sourcemap: false,
    rollupOptions: {
      // The coordinator demo and the installable volunteer app are separate
      // documents with separate entry points; neither ships the other's code.
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        pwa: fileURLToPath(new URL("./pwa.html", import.meta.url)),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.test.{ts,tsx}"],
    // These suites render whole screens and walk full catalogs. On a loaded CI
    // runner the 5s default is a coin toss, so failures should mean failures.
    testTimeout: 30_000,
  },
});
