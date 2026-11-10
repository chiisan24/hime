import {
  ExtractionOutputSchema,
  StageRunKeySchema,
  type ExtractionOutput,
} from "@ehime-vote-navigator/contracts";
import {
  DEFAULT_MAX_PASSAGE_CHARS,
  sha256Hex,
  type RegisteredCandidate,
  type Result,
} from "@ehime-vote-navigator/domain";

import {
  computeInputHash,
  runStage,
  type StageFailure,
  type StageRunnerError,
  type StageRunSuccess,
} from "../analysis/stageRunner.js";
import {
  latestSucceeded,
  type StageStore,
  type StageStoreError,
} from "../analysis/stageStore.js";
import { runExtractStage } from "./extractStage.js";
import type { PdfTextExtractor } from "./pdfTextExtractor.js";

/** Extractor name used in the idempotency key when a test injects its own extractor. */
export const INJECTED_EXTRACTOR_ID = "injected";

export type ExtractAndStoreRequest = Readonly<{
  bytes: Uint8Array;
  candidates: readonly RegisteredCandidate[];
  extractor: PdfTextExtractor;
  /** Names the extraction engine and its version; a different engine is a different run. */
  extractorId: string;
  maxPassageChars?: number;
  now: () => Date;
  revision: string;
  sourceId: string;
  /** Must equal the SHA-256 of `bytes`. */
  sourceSha256: string;
  store: StageStore;
}>;

function parseExtraction(value: unknown): ExtractionOutput | undefined {
  const parsed = ExtractionOutputSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Runs the EXTRACT stage and keeps its output as an immutable StageRun keyed by
 * `{ sourceSha256, revision, "EXTRACT", null, inputHash }`. The input hash covers
 * the source id, the extraction engine, the passage length and the registered
 * candidates, so a changed candidate list produces a new run. The same key is
 * served from the store without extracting again. A NOT_READY result is a
 * completed run: it records why the document cannot be read. The PDF bytes are
 * never written.
 */
export async function extractAndStore(
  request: ExtractAndStoreRequest,
): Promise<Result<StageRunSuccess<ExtractionOutput>, StageRunnerError>> {
  const invalid: Result<never, StageRunnerError> = {
    ok: false,
    error: { code: "INVALID_REQUEST" },
  };
  if (sha256Hex(request.bytes) !== request.sourceSha256) {
    return invalid;
  }

  const maxPassageChars = request.maxPassageChars ?? DEFAULT_MAX_PASSAGE_CHARS;
  const input = {
    sourceId: request.sourceId,
    extractorId: request.extractorId,
    maxPassageChars,
    candidates: request.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      name: candidate.name,
      nameForms: [...candidate.nameForms],
    })),
  };

  let inputHash: string;
  try {
    inputHash = computeInputHash(input);
  } catch {
    return invalid;
  }
  const key = StageRunKeySchema.safeParse({
    sourceSha256: request.sourceSha256,
    revision: request.revision,
    stage: "EXTRACT",
    modelId: null,
    inputHash,
  });
  if (!key.success) {
    return invalid;
  }

  const startedAt = request.now();
  return runStage(
    { now: request.now, store: request.store },
    {
      execute: async (): Promise<Result<ExtractionOutput, StageFailure>> => ({
        ok: true,
        value: await runExtractStage({
          bytes: request.bytes,
          candidates: request.candidates,
          extractor: request.extractor,
          maxPassageChars,
          revision: request.revision,
          sourceId: request.sourceId,
        }),
      }),
      input,
      key: key.data,
      parseOutput: parseExtraction,
      passageId: null,
      runId: `extract-${startedAt.toISOString().replace(/\D/gu, "")}`,
      scope: "STAGE",
    },
  );
}

/**
 * The newest stored EXTRACT output of one source revision, or null when none
 * was saved. Later stages read their passages from here.
 */
export async function loadStoredExtraction(
  store: StageStore,
  location: Readonly<{ revision: string; sourceSha256: string }>,
): Promise<
  Result<ExtractionOutput | null, StageStoreError | Readonly<{ code: "CACHE_CORRUPT" }>>
> {
  const key = StageRunKeySchema.pick({ revision: true, sourceSha256: true }).safeParse({
    revision: location.revision,
    sourceSha256: location.sourceSha256,
  });
  if (!key.success) {
    return { ok: false, error: { code: "INVALID_RUN" } };
  }

  const listed = await store.listRuns({ ...key.data, stage: "EXTRACT" });
  if (!listed.ok) {
    return listed;
  }
  const latest = latestSucceeded(listed.value);
  if (latest === undefined) {
    return { ok: true, value: null };
  }
  const output = parseExtraction(latest.output);
  return output === undefined
    ? { ok: false, error: { code: "CACHE_CORRUPT" } }
    : { ok: true, value: output };
}