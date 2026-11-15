import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { GATE_REASON_CLASS, GATE_REASON_CODES } from "@ehime-vote-navigator/contracts";
import type { GateFinding, GateReasonCode, RealSource } from "@ehime-vote-navigator/contracts";

import { REAL_LOGICAL_ROOT } from "../draft/types.js";
import type { RecordRoot } from "../draft/types.js";
import { evaluateFact } from "../intake/factStatus.js";
import { readAggregationRecords, readRealFacts } from "../intake/factValue.js";
import type { SentenceLists } from "../intake/factValue.js";
import { currentOriginalShas, sourceOf } from "../intake/originals.js";
import { latestRevisionOf, readRealSources } from "../intake/sourceRecords.js";
import { createIntakeStore } from "../intake/storeLayout.js";
import type { RealDataLoader, RealDataOutcome } from "./runBuild.js";

/**
 * The reading and the gates of the real data for the build (13.12, the part that the records of the intake can be judged by).
 *
 * The build asks the loader what is wrong with the real data (`data/real/regional-values/`) and gets findings, each a code, a class
 * (`SHORTAGE`, which a person can supply, or `DEFECT`, which is an error of the data) and the ID of what it is about, and never a value.
 * `resolveDataMode` decides from them: a shortage lets `REAL_PREFERRED` build the fictional data, with the codes as the reasons, and fails `REAL`; a
 * defect fails both, because an error of the real data is not hidden behind the fictional data.
 *
 * What this loader reads and judges (the records that the intake and the creation of fact items write):
 *   - the source records: the terms of use confirmed (`USAGE_NOT_CONFIRMED`, G2), the check of the note of the data set (`NOTE_REVIEW_MISSING`, G2), the information that
 *     the license notice needs (`LICENSE_INFO_MISSING`, G3), for the latest revision of each source and for the source that a fact item rests on;
 *   - the fact items: verified by a person (`FACT_NOT_VERIFIED`, G4), the original that it was made from (`SOURCE_CHANGED`, `SOURCE_FILE_MISSING`), the value and the
 *     sentence against the original (`FACT_VALUE_MISMATCH`), and the source (`FACT_SOURCE_MISMATCH`), with the same judgment as `verify-fact`;
 *   - a record that cannot be read as a record of its contract (`CONTRACT_VIOLATION`).
 * The questions, the issue cards, the results and the fixed texts of real data (13.16), and the gates that rest on them (G4 and G5 of a card, G6
 * of the sources of the cards that an AI drafted, `CARD_COVERAGE_MISSING`, the release of a public build), are not read yet. While there is no card, the real
 * data is absent (`REAL_DATA_ABSENT`, a shortage). A directory that holds anything that this loader does not know is real data that it cannot read, and
 * the answer is `NOT_IMPLEMENTED`: the build fails and does not build the fictional data in its place.
 */

/** What the directory of the real data may hold for this loader to judge it: the records that the intake, the drafts and the approvals write. */
const KNOWN_ENTRIES: ReadonlySet<string> = new Set(["sources", "facts", "aggregations", "datasets", "approvals", "issues", "drafts", "events", "issue-links.json"]);

const REAL_DATA_ABSENT: GateFinding = { code: "REAL_DATA_ABSENT", class: GATE_REASON_CLASS.REAL_DATA_ABSENT, targetKind: "BUNDLE", targetId: null };

function finding(code: GateReasonCode, targetKind: GateFinding["targetKind"], targetId: string | null): GateFinding {
  return { code, class: GATE_REASON_CLASS[code], targetKind, targetId };
}

/** The order of the findings: the order of the codes of the contract, then the target. The same data gives the same list. */
function ordered(findings: readonly GateFinding[]): readonly GateFinding[] {
  const seen = new Set<string>();
  const unique = findings.filter((candidate) => {
    const key = `${candidate.code}\u0000${candidate.targetKind}\u0000${candidate.targetId ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return [...unique].sort((first, second) => {
    const byCode = GATE_REASON_CODES.indexOf(first.code) - GATE_REASON_CODES.indexOf(second.code);
    if (byCode !== 0) {
      return byCode;
    }
    const left = `${first.targetKind}\u0000${first.targetId ?? ""}`;
    const right = `${second.targetKind}\u0000${second.targetId ?? ""}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function sourceFindings(source: RealSource): readonly GateFinding[] {
  const id = `${source.sourceId}/${source.revision}`;
  const found: GateFinding[] = [];
  if (source.usage.status !== "CONFIRMED") {
    found.push(finding("USAGE_NOT_CONFIRMED", "SOURCE", id));
  }
  if (source.datasetNote === null) {
    found.push(finding("NOTE_REVIEW_MISSING", "SOURCE", id));
  }
  // The notice of the license shows the license (name and URL), who published it, and where it came from (a URL).
  if (source.license.name.trim() === "" || source.license.url.trim() === "" || source.publisher.trim() === "" || source.reference.kind !== "url") {
    found.push(finding("LICENSE_INFO_MISSING", "SOURCE", id));
  }
  return found;
}

export type RealDataLoaderOptions = SentenceLists;

/**
 * The loader of the build for the real data. `lists` are the proper nouns and the words in which a kanji numeral is not a number, from the
 * settings of the build: they are what the check of the sentence of a fact item reads, and a check without them is stricter, not looser.
 */
export function createRealDataLoader(lists: RealDataLoaderOptions = {}): RealDataLoader {
  return async (realDataDirectory): Promise<RealDataOutcome> => {
    let entries: string[];
    try {
      entries = await readdir(realDataDirectory);
    } catch {
      return { kind: "FINDINGS", findings: [REAL_DATA_ABSENT] };
    }
    if (entries.length === 0) {
      return { kind: "FINDINGS", findings: [REAL_DATA_ABSENT] };
    }
    if (entries.some((entry) => !KNOWN_ENTRIES.has(entry))) {
      return { kind: "NOT_IMPLEMENTED" };
    }

    const root: RecordRoot = { dataKind: "REAL_AI", rootDir: realDataDirectory, logicalRoot: REAL_LOGICAL_ROOT };
    const store = createIntakeStore(root, { rawRoot: join(realDataDirectory, "..", "raw", "regional-values") });
    const violation = (): RealDataOutcome => ({ kind: "FINDINGS", findings: ordered([REAL_DATA_ABSENT, finding("CONTRACT_VIOLATION", "BUNDLE", null)]) });

    const sources = await readRealSources(store);
    const facts = await readRealFacts(store);
    const records = await readAggregationRecords(store);
    if (!sources.ok || !facts.ok || !records.ok) {
      return violation();
    }

    // The sources that count: the latest revision of each source, and the source that a fact item rests on.
    const counted = new Map<string, RealSource>();
    for (const sourceId of [...new Set(sources.value.map((source) => source.sourceId))]) {
      const latest = latestRevisionOf(sources.value, sourceId);
      if (!latest.ok) {
        return violation();
      }
      if (latest.value !== undefined) {
        counted.set(`${latest.value.sourceId}/${latest.value.revision}`, latest.value);
      }
    }
    for (const fact of facts.value) {
      const source = sourceOf(fact, sources.value);
      if (source !== undefined) {
        counted.set(`${source.sourceId}/${source.revision}`, source);
      }
    }

    const found: GateFinding[] = [
      // There is no card, no question bank and no diagnostic set of real data yet: they are not read by this loader (13.16).
      REAL_DATA_ABSENT,
      ...[...counted.values()].flatMap(sourceFindings),
    ];

    const shas = await currentOriginalShas(store, sources.value);
    for (const fact of facts.value) {
      if (fact.verification.status !== "VERIFIED") {
        found.push(finding("FACT_NOT_VERIFIED", "FACT_ITEM", fact.factId));
      }
      const evaluation = await evaluateFact(store, fact, { facts: facts.value, sources: sources.value, records: records.value, shas, lists });
      for (const code of evaluation.findings) {
        found.push(finding(code as GateReasonCode, "FACT_ITEM", fact.factId));
      }
      if (evaluation.recomputation.state === "UNAVAILABLE" && evaluation.recomputation.reason === "ORIGINAL_MISSING") {
        found.push(finding("SOURCE_FILE_MISSING", "FACT_ITEM", fact.factId));
      }
      // A derived fact item rests on operands that have to count as verified now.
      if (evaluation.problems.some((problem) => problem.startsWith("OPERAND_"))) {
        found.push(finding("FACT_NOT_VERIFIED", "FACT_ITEM", fact.factId));
      }
    }
    return { kind: "FINDINGS", findings: ordered(found) };
  };
}

/** The loader without the lists of the settings. The build gives its own, made with the lists. */
export const defaultRealDataLoader: RealDataLoader = createRealDataLoader();
