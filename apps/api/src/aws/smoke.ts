import { runBedrockSmoke } from "./bedrockSmoke.js";

// Entry point for `npm run bedrock:smoke`. It sends one request to Bedrock only
// when RUN_BEDROCK_SMOKE=1, so importing this file anywhere else is not wanted.
try {
  process.exitCode = await runBedrockSmoke({
    environment: process.env,
    write: (line) => {
      console.log(line);
    },
  });
} catch {
  // Never print the error: it could carry request details.
  console.error("ok=false code=SMOKE_FAILED");
  process.exitCode = 1;
}
