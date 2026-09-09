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
        /*
         * React gets a manual chunk; antd deliberately does not.
         *
         * Phase 1 gave antd one too, for cache stability. Once the admin
         * arrived that became expensive: a name-matched group collects every
         * antd module the build can see, whether or not the storefront can
         * reach it, so the admin's tables, uploader and colour picker were
         * bundled into the chunk shoppers download. Measured on the storefront
         * entry, gzipped: 298 kB with no admin at all, 313 kB letting the
         * bundler split antd by reachability, 459 kB with the manual group.
         *
         * Reachability-based splitting costs a few more requests and wins back
         * ~145 kB, so it is left to the bundler.
         */
        advancedChunks: {
          groups: [{ name: "react", test: /node_modules[\\/](react|react-dom|react-router)/ }],
        },
      },
    },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    /*
     * A taken port is an error, not a quiet move to the next one.
     *
     * Without this Vite slides to 5174 and says so in one line that scrolls
     * away, while the README, the `npm run setup` banner and the default
     * PUBLIC_URL all keep promising 5173 — three wrong answers at once, and
     * Stripe redirects that land nowhere. Failing names the problem instead:
     * stop the other server, or set PORT.
     */
    strictPort: true,
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
