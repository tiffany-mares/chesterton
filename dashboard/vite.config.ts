/// <reference types="vitest/config" />
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 4600,
  },
  preview: {
    port: 4600,
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/setupTests.ts"],
  },
});
