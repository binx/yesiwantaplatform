import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // antd changes far less often than store code, so give it its own
        // chunk rather than busting the whole bundle on every edit.
        advancedChunks: {
          groups: [
            { name: "antd", test: /node_modules[\\/](antd|@ant-design|@rc-component)/ },
            { name: "react", test: /node_modules[\\/](react|react-dom|react-router)/ },
          ],
        },
      },
    },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    // The API server arrives in Phase 2. Until then the storefront reads a
    // schema-validated fixture and never calls the backend.
    proxy: {
      "/api": {
        target: process.env.BELUGA_API_URL ?? "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: true,
    include: ["src/**/*.test.{ts,tsx}", "shared/**/*.test.ts"],
  },
});
