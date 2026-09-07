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
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.API_PORT ?? 4000}`,
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: "client",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          css: true,
          include: ["src/**/*.test.{ts,tsx}", "shared/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          setupFiles: ["./vitest.server-setup.ts"],
          include: ["server/**/*.test.ts", "db/**/*.test.ts"],
          // Each file opens its own SQLite handle; keep them out of each
          // other's way.
          fileParallelism: false,
        },
      },
    ],
  },
});
