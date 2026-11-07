import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createVitePreviewArguments,
  inspectPreviewBuild,
} from "./preview-preflight.mjs";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const requestedMode = process.argv[2];

try {
  const target = await inspectPreviewBuild(webRoot, requestedMode);

  if (process.env.EHIME_PREVIEW_PREFLIGHT_ONLY === "1") {
    console.log(
      `PREVIEW_PREFLIGHT_OK ${target.applicationMode} ${target.outputDirectory}`,
    );
  } else {
    const require = createRequire(import.meta.url);
    const vitePackagePath = require.resolve("vite/package.json");
    const viteCliPath = path.join(path.dirname(vitePackagePath), "bin", "vite.js");
    const child = spawn(
      process.execPath,
      [viteCliPath, ...createVitePreviewArguments(target)],
      {
        cwd: webRoot,
        env: process.env,
        stdio: "inherit",
      },
    );

    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (signal !== null) {
          reject(new Error(`Vite preview stopped by signal ${signal}.`));
          return;
        }
        resolve(code ?? 1);
      });
    });

    process.exitCode = exitCode;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Preview failed.";
  console.error(message);
  process.exitCode = 1;
}
