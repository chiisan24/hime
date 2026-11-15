import { fileURLToPath } from "node:url";

import { runDraftLiveCheck } from "./draftLiveCheck.js";

// Entry point of `npm run bedrock:draft-check`. Without BEDROCK_LIVE_CHECK_APPROVAL it only prints the plan and sends nothing.
// It is compiled to apps/api/dist/regional-values/draftLiveCheckMain.js, so the root of the repository is four levels up.
const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));

try {
  process.exitCode = await runDraftLiveCheck({
    environment: process.env,
    workspaceRoot,
    argv: process.argv.slice(2),
    write: (line) => {
      console.log(line);
    },
  });
} catch {
  // Never print the error: it could carry request details.
  console.error("code=LIVE_CHECK_FAILED");
  process.exitCode = 1;
}
