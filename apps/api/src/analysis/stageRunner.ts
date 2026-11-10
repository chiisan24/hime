import {
  StageRunKeySchema,
  StageRunSchema,
  type StageRun,
  type StageRunKey,
} from "@ehime-vote-navigator/contracts";
import { encodeCanonicalJson, sha256Hex, type Result } from "@ehime-vote-navigator/domain";

import { computeStageRunId, type StageStore } from "./stageStore.js";

/** A stage reports a failure with a fixed code only, never with a message or a body. */
export type StageFailure = Readonly<{ code: string }>;

export type StageRunnerError =
  | Readonly<{
      code:
        | "CACHE_CORRUPT"
        | "INVALID_REQUEST"
        | "OUTPUT_INVALID"
        | "STORE_READ_FAILED"
        | "STORE_WRITE_FAILED";
    }>
  | Readonly<{ code: "STAGE_FAILED"; recorded: boolean; stageCode: string }>;

export type StageRunSuccess<Output> = Readonly<{
  /** True when a stored SUCCEEDED run was returned and the stage was not executed. */
  cached: boolean;
  output: Output;
  stageRunId: string;
}>;

export type RunStageRequest<Output> = Readonly<{
  execute: () => Promise<Result<Output, StageFailure>>;
  /** What the stage was given, stored with the run. It must not hold secrets or prompts. */
  input: unknown;
  key: StageRunKey;
  /** Re-validates a stage output; returns undefined when it is not valid. */
  parseOutput: (value: unknown) => Output | undefined;
  passageId: string | null;
  runId: string;
  scope: StageRun["scope"];
}>;

export type StageRunnerDependencies = Readonly<{
  now: () => Date;
  store: StageStore;
}>;

const STAGE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;
const FALLBACK_STAGE_CODE = "STAGE_ERROR";

/** Hash of a stage input in canonical JSON; part of the idempotency key. */
export function computeInputHash(input: unknown): string {
  return sha256Hex(encodeCanonicalJson(input));
}

function failure(code: Exclude<StageRunnerError["code"], "STAGE_FAILED">): Result<never, StageRunnerError> {
  return { ok: false, error: { code } };
}

async function recordFailure(
  dependencies: StageRunnerDependencies,
  request: RunStageRequest<unknown>,
  key: StageRunKey,
  stageRunId: string,
  errorClass: string,
): Promise<boolean> {
  const run = StageRunSchema.safeParse({
    stageRunId,
    key,
    runId: request.runId,
    scope: request.scope,
    passageId: request.passageId,
    status: "FAILED",
    input: request.input,
    output: null,
    errorClass,
    createdAt: dependencies.now().toISOString(),
  });
  if (!run.success) {
    return false;
  }
  return (await dependencies.store.saveRun(run.data)).ok;
}

/**
 * Runs one stage with the idempotency cache. A stored SUCCEEDED run with the
 * same key is returned without executing the stage. A failure is recorded as a
 * separate FAILED run; it is never used as a cache hit and never changes a
 * stored SUCCEEDED run.
 */
export async function runStage<Output>(
  dependencies: StageRunnerDependencies,
  request: RunStageRequest<Output>,
): Promise<Result<StageRunSuccess<Output>, StageRunnerError>> {
  const key = StageRunKeySchema.safeParse(request.key);
  if (!key.success) {
    return failure("INVALID_REQUEST");
  }
  const stageRunId = computeStageRunId(key.data);

  const found = await dependencies.store.findSucceeded(key.data);
  if (!found.ok) {
    return failure(found.error.code === "INVALID_RUN" ? "INVALID_REQUEST" : "STORE_READ_FAILED");
  }
  if (found.value !== null) {
    const cachedOutput = request.parseOutput(found.value.output);
    return cachedOutput === undefined
      ? failure("CACHE_CORRUPT")
      : { ok: true, value: { cached: true, output: cachedOutput, stageRunId } };
  }

  let outcome: Result<Output, StageFailure>;
  try {
    outcome = await request.execute();
  } catch {
    outcome = { ok: false, error: { code: "STAGE_EXCEPTION" } };
  }

  if (!outcome.ok) {
    const stageCode = STAGE_CODE.test(outcome.error.code) ? outcome.error.code : FALLBACK_STAGE_CODE;
    const recorded = await recordFailure(dependencies, request, key.data, stageRunId, stageCode);
    return { ok: false, error: { code: "STAGE_FAILED", recorded, stageCode } };
  }

  const output = request.parseOutput(outcome.value);
  if (output === undefined) {
    await recordFailure(dependencies, request, key.data, stageRunId, "OUTPUT_INVALID");
    return failure("OUTPUT_INVALID");
  }

  const run = StageRunSchema.safeParse({
    stageRunId,
    key: key.data,
    runId: request.runId,
    scope: request.scope,
    passageId: request.passageId,
    status: "SUCCEEDED",
    input: request.input,
    output,
    errorClass: null,
    createdAt: dependencies.now().toISOString(),
  });
  if (!run.success) {
    return failure("INVALID_REQUEST");
  }

  const saved = await dependencies.store.saveRun(run.data);
  if (!saved.ok) {
    return failure(saved.error.code === "STORE_WRITE_FAILED" ? "STORE_WRITE_FAILED" : "OUTPUT_INVALID");
  }
  return { ok: true, value: { cached: false, output, stageRunId } };
}