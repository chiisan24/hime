import { ISOInstantSchema, Sha256Schema } from "@ehime-vote-navigator/contracts";
import type { DraftRecord, DraftRunKey, DraftTask, ThemeDef } from "@ehime-vote-navigator/contracts";
import { encodeCanonicalJson, sha256Hex } from "@ehime-vote-navigator/domain";

import type { Pacer } from "../../analysis/pacer.js";
import { ALLOWED_BEDROCK_MODEL_IDS } from "../../aws/bedrockConverse.js";
import type { BedrockConverseClient, BedrockConverseError } from "../../aws/bedrockConverse.js";
import type { SafeLogger } from "../../logging/safeLogger.js";
import { factNumeralsOf, runDraftChecks } from "./checks.js";
import type { DraftCheckConfig, DraftCheckViolation } from "./checks.js";
import { checkDraftInput, inputSourcesOf } from "./checkDraftInput.js";
import type { DraftInputContext, DraftInputMaterial, DraftInputReason } from "./checkDraftInput.js";
import { draftIdOf, makeDraftEvent } from "./draftStore.js";
import type { DraftStore, StoreErrorCode } from "./draftStore.js";
import { buildPrompt, PROMPT_VERSION } from "./prompts/index.js";
import { DraftRequestSchema } from "./request.js";
import { fail, succeed } from "./types.js";
import type { Outcome } from "./types.js";

/**
 * Runs one AI draft (design: 保存、冪等性、制約, steps 1 to 7). The one place that calls the model.
 * Everything it needs is an argument, so a test gives a fake client and a directory of its own, and
 * nothing here reaches the network by itself.
 *
 * The order is fixed so that the cheap and the safe come first: the request, the models, the gate
 * of the input (no call and no record when it refuses), the key, the saved draft of the same key
 * (no call and no new record), and only then the pace and the call.
 */

export type DraftModels = Readonly<{
  /** The model of the tasks that write (`generation`). */
  generation: string;
  /** The model of the second opinion (`verification`). */
  verification: string;
}>;

export type DraftDeps = Readonly<{
  client: BedrockConverseClient;
  store: DraftStore;
  pacer: Pacer;
  now: () => Date;
  models: DraftModels;
  /** The limits of an input, and how to find the current SHA-256 of an original if it is known. */
  gate: Omit<DraftInputContext, "bulletinSha256s">;
  /**
   * Whether an original is an election bulletin that the existing intake registered (Req 7.12). It
   * only reads. An error is not caught here as "no": a lookup that fails refuses the run.
   */
  isElectionBulletin: (sha256: string) => Promise<boolean>;
  checks: DraftCheckConfig;
  /** The six themes with their labels, for the check of a question. */
  themes: readonly ThemeDef[];
  /** A logger that takes fixed codes and counts only. The prompt and the response are never given to it. */
  logger?: SafeLogger;
}>;

export type DraftSuccess = Readonly<{
  draftId: string;
  task: DraftTask;
  /** `true` when the draft of the same key was saved already: nothing was called and no record was added. */
  cached: boolean;
  modelId: string;
}>;

export type DraftError =
  | Readonly<{ code: "REQUEST_INVALID" }>
  | Readonly<{ code: "INPUT_REFUSED"; reasons: readonly DraftInputReason[] }>
  | Readonly<{ code: "REVIEW_MODEL_SAME_AS_DRAFT" }>
  | Readonly<{ code: "MODEL_NOT_ALLOWED" | "RATE_LIMITED" | "TIMEOUT" | "AUTH" | "SERVICE_ERROR" | "INPUT_TOO_LONG" | "INPUT_INVALID" }>
  | Readonly<{ code: "CHECK_FAILED"; violations: readonly DraftCheckViolation[] }>
  | Readonly<{ code: "STORE_READ_FAILED" | "STORE_WRITE_FAILED"; cause: StoreErrorCode }>;

export type DraftOutcome = Outcome<DraftSuccess, DraftError>;

/** Which model a task uses (design: 使用モデルの選択). */
export function modelRoleOf(task: DraftTask): "generation" | "verification" {
  return task === "NEUTRALITY_REVIEW" ? "verification" : "generation";
}

/** What an error of the client is in the draft process (design: 既存クライアントの結果). */
export function mapClientError(error: BedrockConverseError): DraftError {
  switch (error.code) {
    case "TIMEOUT":
    case "RATE_LIMITED":
    case "MODEL_NOT_ALLOWED":
    case "INPUT_TOO_LONG":
    case "INPUT_INVALID":
      return { code: error.code };
    case "TOKEN_INVALID":
    case "CONFIG_NOT_READY":
      return { code: "AUTH" };
    case "HTTP_ERROR":
      return { code: error.status === 401 || error.status === 403 ? "AUTH" : "SERVICE_ERROR" };
    case "NETWORK_ERROR":
    case "RESPONSE_INVALID":
    case "BUSY":
      return { code: "SERVICE_ERROR" };
  }
}

function finish(deps: DraftDeps, task: string, outcome: DraftOutcome): DraftOutcome {
  deps.logger?.info({
    code: outcome.ok ? "DRAFT_OK" : outcome.error.code,
    task,
    ...(outcome.ok ? { cached: outcome.value.cached } : {}),
  });
  return outcome;
}

export async function runDraft(deps: DraftDeps, rawRequest: unknown): Promise<DraftOutcome> {
  // 1. The request.
  const parsed = DraftRequestSchema.safeParse(rawRequest);
  if (!parsed.success) {
    return finish(deps, "UNKNOWN", fail({ code: "REQUEST_INVALID" }));
  }
  const request = parsed.data;
  const { task } = request;
  const done = (outcome: DraftOutcome): DraftOutcome => finish(deps, task, outcome);

  // The models. A second opinion is not given by the model that drafted.
  const modelId = deps.models[modelRoleOf(task)];
  if (task === "NEUTRALITY_REVIEW" && request.draftModelId === modelId) {
    return done(fail({ code: "REVIEW_MODEL_SAME_AS_DRAFT" }));
  }
  if (!ALLOWED_BEDROCK_MODEL_IDS.includes(modelId)) {
    return done(fail({ code: "MODEL_NOT_ALLOWED" }));
  }

  // 2. The gate of the input.
  const prompt = buildPrompt(request, { premiseTemplates: deps.checks.neutrality.premiseTemplates });
  const material: DraftInputMaterial = {
    task,
    dataKind: request.dataKind,
    system: prompt.system,
    text: prompt.text,
    materials: prompt.materials,
    facts: request.facts,
    evidence: request.evidence,
    sources: request.sources,
    factRegistry: request.factRegistry ?? request.facts,
  };
  const bulletinSha256s = new Set<string>();
  try {
    const hashes = new Set<string>([
      ...request.sources.flatMap((source) => (source.dataKind === "REAL_AI" ? [source.sha256] : [])),
      ...request.facts.flatMap((fact) => (fact.dataKind === "REAL_AI" ? [fact.sha256] : [])),
    ]);
    for (const sha256 of hashes) {
      if (await deps.isElectionBulletin(sha256)) {
        bulletinSha256s.add(sha256);
      }
    }
  } catch {
    return done(fail({ code: "STORE_READ_FAILED", cause: "READ_FAILED" }));
  }
  const gate = checkDraftInput(material, { ...deps.gate, bulletinSha256s });
  const reasons: DraftInputReason[] = gate.ok ? [] : [...gate.reasons];
  if (request.dataKind !== deps.store.root.dataKind && !reasons.includes("DATA_KIND_MIXED")) {
    // An input of one kind is not kept among the records of the other kind.
    reasons.unshift("DATA_KIND_MIXED");
  }
  if (reasons.length > 0) {
    return done(fail({ code: "INPUT_REFUSED", reasons }));
  }

  // 3. The key.
  const inputSources = inputSourcesOf(material);
  const inputHash = Sha256Schema.parse(sha256Hex(encodeCanonicalJson({ system: prompt.system, text: prompt.text, inputSources })));
  const key: DraftRunKey = { task, promptVersion: PROMPT_VERSION, modelId, inputHash };
  const draftId = draftIdOf(key);

  // 4. A draft of the same key that is saved already is the answer. Nothing is called.
  const existing = await deps.store.findDraft(task, draftId);
  if (!existing.ok) {
    return done(fail({ code: "STORE_READ_FAILED", cause: existing.error.code }));
  }
  if (existing.value !== null) {
    // The record of the call must be there: a draft that was saved when the record failed is completed here.
    const events = await deps.store.loadEvents();
    if (!events.ok) {
      return done(fail({ code: "STORE_READ_FAILED", cause: events.error.code }));
    }
    if (!events.value.some((event) => event.kind === "DRAFTED" && event.draftId === draftId)) {
      const appended = await deps.store.appendEvent(
        makeDraftEvent({ at: existing.value.generatedAt, dataKind: existing.value.dataKind, task, kind: "DRAFTED", draftId }),
      );
      if (!appended.ok) {
        return done(fail({ code: "STORE_WRITE_FAILED", cause: appended.error.code }));
      }
    }
    return done(succeed({ draftId, task, cached: true, modelId }));
  }

  // 5. The pace and the call.
  await deps.pacer.wait();
  const response = await deps.client.converse({ modelId, system: prompt.system, text: prompt.text });
  if (!response.ok) {
    return done(fail(mapClientError(response.error)));
  }

  // 6. The checks.
  const at = ISOInstantSchema.parse(deps.now().toISOString());
  const checked = runDraftChecks(response.value.text, {
    task,
    dataKind: request.dataKind,
    config: deps.checks,
    evidence: request.evidence,
    facts: request.facts,
    themes: deps.themes,
    factNumerals: factNumeralsOf([...request.facts, ...(request.factRegistry ?? [])]),
    today: at.slice(0, 10),
  });
  if (!checked.ok) {
    // The output is not saved, but it is counted: the call gave an output, and the checks refused it.
    for (const event of [
      makeDraftEvent({ at, dataKind: request.dataKind, task, kind: "DRAFTED", draftId }),
      makeDraftEvent({ at, dataKind: request.dataKind, task, kind: "REJECTED_BY_CHECKS", draftId: null }),
    ]) {
      const appended = await deps.store.appendEvent(event);
      if (!appended.ok) {
        return done(fail({ code: "STORE_WRITE_FAILED", cause: appended.error.code }));
      }
    }
    return done(fail({ code: "CHECK_FAILED", violations: checked.violations }));
  }

  // 7. The draft is saved as it is, and the call is recorded. A draft has no field of its fate.
  const record: DraftRecord = {
    draftId,
    key,
    dataKind: request.dataKind,
    aiClass: "AI_DRAFT",
    modelId,
    generatedAt: at,
    inputSources: [...inputSources],
    output: checked.output,
  };
  const saved = await deps.store.saveDraft(record);
  if (!saved.ok) {
    return done(fail({ code: "STORE_WRITE_FAILED", cause: saved.error.code }));
  }
  const drafted = await deps.store.appendEvent(makeDraftEvent({ at, dataKind: request.dataKind, task, kind: "DRAFTED", draftId }));
  if (!drafted.ok) {
    return done(fail({ code: "STORE_WRITE_FAILED", cause: drafted.error.code }));
  }
  return done(succeed({ draftId, task, cached: false, modelId }));
}
