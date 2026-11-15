import type {
  DataKind,
  DraftTask,
  EvidenceUnit,
  FactItem,
  FixtureSource,
  RealFact,
  RealSource,
} from "@ehime-vote-navigator/contracts";
import { effectiveVerification } from "@ehime-vote-navigator/domain";

import { MAX_CONVERSE_INPUT_CHARS } from "../../aws/bedrockConverse.js";
import { DATA_CLOSE, DATA_OPEN } from "./prompts/delimiters.js";

/**
 * The gate of the AI draft process (Req 8.5 to 8.7, 8.23). It judges what is about to be sent, before
 * anything is sent: it does not call anything and it does not save anything. When it refuses, it
 * says every condition that is not met, so that one run shows what has to be supplied.
 *
 * The input of a draft has no field for an answer of a user, the priority theme, the values map or
 * a free text of a user (Req 8.3): the type has none, and the static check of 11.9 keeps it so.
 */

export type DraftSourceRecord = RealSource | FixtureSource;

export type DraftInputMaterial = Readonly<{
  task: DraftTask;
  dataKind: DataKind;
  /** The system instruction and the body, as they are given to the client. */
  system: string;
  text: string;
  /** The pieces of external text that are put in the body (quotations, sentences of facts). They must not hold the delimiter. */
  materials: readonly string[];
  /** The fact items of the input (an issue candidate rests on them). */
  facts: readonly FactItem[];
  /** The quotations of the input (the tasks that write a card). */
  evidence: readonly EvidenceUnit[];
  /** The records of the sources that the facts and the quotations come from. */
  sources: readonly DraftSourceRecord[];
  /** Every fact item of the data kind, to find the operands of a derived fact. */
  factRegistry: readonly FactItem[];
}>;

export type DraftInputLimits = Readonly<{
  /** The number of the facts and the quotations of one input at most (`draft.json`). */
  maxEvidenceUnits: number;
  /** The length of a quotation at most (`draft.json`). */
  evidenceMaxChars: number;
}>;

export type DraftInputContext = Readonly<{
  limits: DraftInputLimits;
  /** The SHA-256 values of the election bulletins that are registered. An election bulletin is not an input (Req 7.12). */
  bulletinSha256s: ReadonlySet<string>;
  /**
   * The SHA-256 of an original as it is now. Without it the original is taken as unchanged; with
   * it, a fact whose original changed is not verified now (`effectiveVerification`).
   */
  currentSha256?: (fact: RealFact) => string | undefined;
}>;

/** The reasons of a refusal, in the order in which they are listed. */
export const DRAFT_INPUT_REASONS = [
  "DATA_KIND_MIXED",
  "INPUT_IS_ELECTION_BULLETIN",
  "FACTS_MISSING",
  "FACT_NOT_VERIFIED",
  "FACT_SOURCE_MISMATCH",
  "CONVERSION_RECORD_MISSING",
  "USAGE_NOT_CONFIRMED",
  "TRANSMISSION_NOT_ALLOWED",
  "INPUT_TOO_MANY_UNITS",
  "EVIDENCE_TOO_LONG",
  "INPUT_CONTAINS_DELIMITER",
  "INPUT_TOO_LONG",
] as const;

export type DraftInputReason = (typeof DRAFT_INPUT_REASONS)[number];

export type DraftInputResult = Readonly<{ ok: true }> | Readonly<{ ok: false; reasons: readonly DraftInputReason[] }>;

/** The extensions of a file that a person has to convert to a text before it is taken in. */
const CONVERTED_EXTENSIONS = [".xlsx", ".xls", ".ods"] as const;

/**
 * A source that is a text made from a file of another format has the record of the conversion
 * (Req 7.24): the SHA-256 of the original and of the converted file, the procedure and the person.
 * The format is read from the name of the file that the source points to. This is a judgement from
 * the name, because the contract does not say what format the publisher offered.
 */
function needsConversionRecord(source: RealSource): boolean {
  if (source.reference.kind !== "url" || source.locator.kind !== "text-lines") {
    return false;
  }
  let path: string;
  try {
    path = new URL(source.reference.url).pathname.toLowerCase();
  } catch {
    return false;
  }
  return CONVERTED_EXTENSIONS.some((extension) => path.endsWith(extension));
}

const isReal = <T extends { dataKind: DataKind }>(item: T): item is Extract<T, { dataKind: "REAL_AI" }> =>
  item.dataKind === "REAL_AI";

function registryOf(input: DraftInputMaterial): ReadonlyMap<string, RealFact> {
  const registry = new Map<string, RealFact>();
  for (const fact of input.factRegistry) {
    if (fact.dataKind === "REAL_AI") {
      registry.set(fact.factId, fact);
    }
  }
  return registry;
}

type UsedSources = Readonly<{
  /** The sources that the input rests on, by source ID and revision. */
  used: ReadonlyMap<string, RealSource>;
  /** A fact or a quotation whose source cannot be told (none, or more than one). */
  mismatch: boolean;
}>;

/**
 * The sources that a real input rests on. A fact is tied to its source by the SHA-256 of its
 * original (a SHA-256 is of one source: D21), and a quotation by its source ID. A derived fact rests
 * on both of its operands, so the source of the second operand is in the list too: the record of the
 * draft must not lose where the second value came from.
 */
function usedSourcesOf(input: DraftInputMaterial): UsedSources {
  const used = new Map<string, RealSource>();
  let mismatch = false;
  if (input.dataKind !== "REAL_AI") {
    return { used, mismatch };
  }
  const sources = input.sources.filter(isReal);
  const registry = registryOf(input);
  const add = (source: RealSource): void => {
    used.set(`${source.sourceId}@${source.revision}`, source);
  };
  const addBySha256 = (fact: RealFact): void => {
    const matches = sources.filter((source) => source.sha256 === fact.sha256);
    if (matches.length !== 1 || matches[0] === undefined) {
      mismatch = true;
      return;
    }
    add(matches[0]);
  };

  for (const fact of input.facts.filter(isReal)) {
    addBySha256(fact);
    if (fact.method.kind === "DERIVED") {
      for (const operandId of fact.method.operandFactIds) {
        const operand = registry.get(operandId);
        if (operand !== undefined) {
          addBySha256(operand);
        }
      }
    }
  }
  for (const unit of input.evidence) {
    const matches = sources.filter((source) => source.sourceId === unit.sourceId);
    if (matches.length !== 1 || matches[0] === undefined) {
      mismatch = true;
    } else {
      add(matches[0]);
    }
  }
  return { used, mismatch };
}

export function checkDraftInput(input: DraftInputMaterial, context: DraftInputContext): DraftInputResult {
  const found = new Set<DraftInputReason>();

  // Kinds. Fictional data and real data are not put in one input.
  const kinds = [...input.facts.map((fact) => fact.dataKind), ...input.sources.map((source) => source.dataKind)];
  if (kinds.some((kind) => kind !== input.dataKind)) {
    found.add("DATA_KIND_MIXED");
  }

  // An election bulletin is not an input of this feature.
  if (
    input.sources.filter(isReal).some((source) => context.bulletinSha256s.has(source.sha256)) ||
    input.facts.filter(isReal).some((fact) => context.bulletinSha256s.has(fact.sha256))
  ) {
    found.add("INPUT_IS_ELECTION_BULLETIN");
  }

  // Something to rest on: facts for a candidate, quotations for the tasks that write a card.
  const needsFacts = input.task === "ISSUE_CANDIDATE";
  const needsEvidence = input.task === "ISSUE_SUMMARY" || input.task === "BACKGROUND_DRAFT" || input.task === "TERM_GLOSS";
  if ((needsFacts && input.facts.length === 0) || (needsEvidence && input.evidence.length === 0)) {
    found.add("FACTS_MISSING");
  }

  // The size of the input.
  if (input.facts.length + input.evidence.length > context.limits.maxEvidenceUnits) {
    found.add("INPUT_TOO_MANY_UNITS");
  }
  if (input.evidence.some((unit) => Array.from(unit.text).length > context.limits.evidenceMaxChars)) {
    found.add("EVIDENCE_TOO_LONG");
  }
  // The instruction names the delimiters, so only the material can break out of them.
  if (input.materials.some((piece) => piece.includes(DATA_OPEN) || piece.includes(DATA_CLOSE))) {
    found.add("INPUT_CONTAINS_DELIMITER");
  }
  // UTF-16 code units, as the client counts them (D28).
  if (input.system.length + input.text.length > MAX_CONVERSE_INPUT_CHARS) {
    found.add("INPUT_TOO_LONG");
  }

  // Real data: the facts are verified, and the terms of use and the sending are confirmed for every source.
  if (input.dataKind === "REAL_AI") {
    const registry = registryOf(input);
    const currentSha256 = context.currentSha256 ?? ((fact: RealFact) => fact.sha256);
    for (const fact of input.facts.filter(isReal)) {
      if (effectiveVerification(fact, { factsById: registry, currentSha256 }).status !== "VERIFIED") {
        found.add("FACT_NOT_VERIFIED");
      }
    }
    const { used, mismatch } = usedSourcesOf(input);
    if (mismatch) {
      found.add("FACT_SOURCE_MISMATCH");
    }
    for (const source of used.values()) {
      if (source.usage.status !== "CONFIRMED") {
        found.add("USAGE_NOT_CONFIRMED");
      }
      if (source.transmission.status !== "ALLOWED") {
        found.add("TRANSMISSION_NOT_ALLOWED");
      }
      if (needsConversionRecord(source) && source.conversion === undefined) {
        found.add("CONVERSION_RECORD_MISSING");
      }
    }
  }

  return found.size === 0 ? { ok: true } : { ok: false, reasons: DRAFT_INPUT_REASONS.filter((reason) => found.has(reason)) };
}

export type InputSourceRecord = Readonly<{ sourceId: string; revision: RealSource["revision"]; sha256: RealSource["sha256"] }>;

/**
 * The sources that an input rests on, for the record of a draft (Req 8.8): each with the revision and
 * the SHA-256 of its original, in the order of the ID and the revision. A derived fact brings the
 * sources of both operands. Fictional data has no original, so it has no source record.
 */
export function inputSourcesOf(input: DraftInputMaterial): readonly InputSourceRecord[] {
  return [...usedSourcesOf(input).used.values()]
    .map((source) => ({ sourceId: source.sourceId, revision: source.revision, sha256: source.sha256 }))
    .sort((first, second) => {
      const left = `${first.sourceId}\u0000${first.revision}`;
      const right = `${second.sourceId}\u0000${second.revision}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
}
