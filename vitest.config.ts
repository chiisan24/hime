import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    setupFiles: ["./tests/setup.ts"],
    unstubEnvs: true,
    unstubGlobals: true,
    include: [
      "apps/**/*.test.{ts,tsx}",
      "packages/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
  },
});
