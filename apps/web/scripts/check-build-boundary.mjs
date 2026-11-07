import { fileURLToPath } from "node:url";

import {
  formatBuildBoundaryReport,
  runBuildBoundaryCheck,
} from "./build-boundary.mjs";

const USAGE = "Usage: node ./scripts/check-build-boundary.mjs [--output-root <empty directory outside the repository>]";

function parseArguments(argv) {
  if (argv.length === 0) {
    return { outputRoot: undefined };
  }
  if (argv.length === 2 && argv[0] === "--output-root" && argv[1] !== "") {
    return { outputRoot: argv[1] };
  }
  throw new Error(USAGE);
}

const webRoot = fileURLToPath(new URL("../", import.meta.url));

try {
  const { outputRoot } = parseArguments(process.argv.slice(2));
  const report = await runBuildBoundaryCheck({ webRoot, outputRoot });

  for (const line of formatBuildBoundaryReport(report)) {
    console.log(line);
  }
  process.exitCode = report.ok ? 0 : 1;
} catch (error) {
  const message = error instanceof Error ? error.message : "Build boundary check failed.";
  console.error(`BUILD_BOUNDARY_FAILED: ${message}`);
  console.error("BUILD_BOUNDARY_RESULT FAIL");
  process.exitCode = 1;
}
