import { defineConfig } from "vitest/config";

import { createWebViteConfig } from "./apps/web/vite.config.js";

export default defineConfig(({ mode }) => ({
  resolve: {
    // `#app-routes` comes from the web Vite config factory, so Vitest selects the
    // route entry with the same fail-closed resolver as `vite`: only the exact
    // `analyst` mode selects the Analyst entry, and the default Vitest mode
    // (`test`) selects the Visitor entry.
    alias: createWebViteConfig(mode).resolve?.alias ?? {},
  },
  test: {
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    setupFiles: ["./tests/setup.ts"],
    unstubEnvs: true,
    unstubGlobals: true,
    // Measured on the 16-thread Windows development machine (about 2 GB free
    // RAM): with the default worker count, 51 per-file forks took ~10.9 s each to
    // start, and 11 first-render, git-spawn, and HTTP tests timed out (10 at the
    // 5 s default). The same files passed alone. With 4 workers, startup fell
    // to ~2.2 s, but one test that runs 12 synchronous `git check-ignore`
    // spawns still took 6.5 s. Limiting workers and adding timeout headroom keeps
    // `npm test` reliable. Assertions and property run counts are unchanged.
    maxWorkers: 4,
    testTimeout: 20_000,
    include: [
      "apps/**/*.test.{ts,tsx}",
      "packages/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
  },
}));
