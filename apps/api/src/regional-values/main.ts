import { fileURLToPath } from "node:url";

import { runRegionalValuesCli } from "./cli.js";

// `npm run regional-values -- build ...` の入口。apps/api/dist/regional-values/main.js にコンパイルされるので、
// リポジトリのルートは4階層上にある。
const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));

try {
  process.exitCode = await runRegionalValuesCli(process.argv.slice(2), {
    workspaceRoot,
    io: {
      write: (line) => {
        console.log(line);
      },
    },
  });
} catch {
  // エラーは出力しない。ファイルパスやデータが含まれる可能性があるため。
  console.error("code=REGIONAL_VALUES_CLI_FAILED");
  process.exitCode = 1;
}
