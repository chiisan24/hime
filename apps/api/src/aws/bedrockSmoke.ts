import { resolveAwsConfig, type AwsEnvironment } from "../config/aws.js";

import {
  createBedrockConverseClient,
  type BedrockConverseClient,
  type BedrockConverseError,
} from "./bedrockConverse.js";

/** The only input the smoke command ever sends (a harmless greeting). */
export const SMOKE_INPUT_TEXT = "こんにちは";
export const SMOKE_SYSTEM_TEXT =
  "あなたは簡潔に答えるアシスタントです。短い日本語で一文だけ返答してください。";
export const SMOKE_REPLY_PREVIEW_CHARS = 100;

export type BedrockSmokeOptions = Readonly<{
  environment: AwsEnvironment;
  write: (line: string) => void;
  /** Replaces the real client; tests use this with a fake `fetch`. */
  client?: BedrockConverseClient;
  now?: () => number;
}>;

function describeFailure(error: BedrockConverseError): string {
  return error.code === "HTTP_ERROR"
    ? `code=HTTP_ERROR status=${error.status}`
    : `code=${error.code}`;
}

/** First characters of the reply on one line, never splitting a code point. */
function previewReply(text: string): string {
  return Array.from(text.replace(/\s+/gu, " ").trim())
    .slice(0, SMOKE_REPLY_PREVIEW_CHARS)
    .join("");
}

/**
 * Sends one fixed request to the generation model and prints only the outcome:
 * ok flag, HTTP status or failure code, model ID, elapsed milliseconds, and a
 * short reply preview. Returns the process exit code (0 only on success).
 * Missing settings are reported by name; no value is ever printed.
 */
export async function runBedrockSmoke(
  options: BedrockSmokeOptions,
): Promise<number> {
  const { environment, write } = options;
  const now = options.now ?? Date.now;

  if (environment["RUN_BEDROCK_SMOKE"] !== "1") {
    write("Refused: set RUN_BEDROCK_SMOKE=1 to send the single smoke request.");
    return 1;
  }

  const resolved = resolveAwsConfig(environment);
  if (!resolved.ok) {
    write("NOT_READY: the Bedrock settings are incomplete. No request was sent.");
    for (const name of resolved.error.missing) {
      write(`missing: ${name}`);
    }
    for (const violation of resolved.error.violations) {
      write(`rejected: ${violation.name} (${violation.code})`);
    }
    return 1;
  }

  const modelId = resolved.value.models.generation;
  const client =
    options.client ?? createBedrockConverseClient({ environment, now });
  const startedAt = now();
  const result = await client.converse({
    modelId,
    system: SMOKE_SYSTEM_TEXT,
    text: SMOKE_INPUT_TEXT,
  });
  const elapsedMs = now() - startedAt;

  if (!result.ok) {
    write(
      `ok=false ${describeFailure(result.error)} model=${modelId} elapsedMs=${elapsedMs}`,
    );
    if (result.error.code === "CONFIG_NOT_READY") {
      for (const name of result.error.notReady.missing) {
        write(`missing: ${name}`);
      }
    }
    return 1;
  }

  write(
    `ok=true status=${result.value.status} model=${modelId} elapsedMs=${elapsedMs}`,
  );
  write(`reply: ${previewReply(result.value.text)}`);
  return 0;
}
