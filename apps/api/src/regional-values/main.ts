import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { runRegionalValuesCli } from "./cli.js";

// `npm run regional-values -- build ...` の入口。apps/api/dist/regional-values/main.js にコンパイルされるので、
// リポジトリのルートは4階層上にある。
const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));

// 課題の承認の確認項目に使う。入力が閉じられた場合と y/yes 以外の答えは「いいえ」として扱い、何も保存しない。
async function confirm(question: string): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
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
  process.exitCode = await runRegionalValuesCli(process.argv.slice(2), {
    workspaceRoot,
    io: {
      confirm,
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
