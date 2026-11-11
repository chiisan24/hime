import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { runAnalysisCli } from "./cli.js";

// Entry point for `npm run analysis -- <command>`. Compiled to
// apps/api/dist/analysis/main.js, so the repository root is four levels up.
const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));

async function confirm(question: string): Promise<boolean> {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // A closed input counts as "no", so nothing is saved without an answer.
    const answer = await new Promise<string>((resolveAnswer) => {
      terminal.once("close", () => {
        resolveAnswer("");
      });
      terminal.question(question).then(resolveAnswer, () => {
        resolveAnswer("");
      });
    });

    return /^(?:y|yes)$/iu.test(answer.trim());
  } finally {
    terminal.close();
  }
}

try {
  process.exitCode = await runAnalysisCli(process.argv.slice(2), {
    workspaceRoot,
    io: {
      confirm,
      write: (line) => {
        console.log(line);
      },
    },
    // OCR_TRACE=1 writes step times, memory use and a heartbeat to stderr (no page text).
    ...(process.env.OCR_TRACE === "1"
      ? {
          ocrTrace: {
            write: (line: string) => {
              console.error(line);
            },
          },
        }
      : {}),
  });
} catch {
  // Never print the error: it could carry file paths or data.
  console.error("code=ANALYSIS_CLI_FAILED");
  process.exitCode = 1;
}