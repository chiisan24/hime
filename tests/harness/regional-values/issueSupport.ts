import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApprovalLedgerRecordSchema, IssueSourceRecordSchema } from "@ehime-vote-navigator/contracts";
import type { DataKind, FactItem, FixtureFact, IssueConfirmation, IssueSourceRecord, RealFact, RealSource } from "@ehime-vote-navigator/contracts";
import { encodeCanonicalJson, sha256Hex } from "@ehime-vote-navigator/domain";

import { appendLedgerRecord, hashOf } from "../../../apps/api/src/regional-values/draft/approvalLedger.js";
import { createDraftStore, writeImmutableRecord } from "../../../apps/api/src/regional-values/draft/draftStore.js";
import { approveTarget, revokeApproval } from "../../../apps/api/src/regional-values/draft/review.js";
import { createFileIssueInputs } from "../../../apps/api/src/regional-values/issues/inputs.js";
import type { IssueInputs } from "../../../apps/api/src/regional-values/issues/inputs.js";
import { loadIssueSnapshot } from "../../../apps/api/src/regional-values/issues/loadIssueSnapshot.js";
import type { IssueSettings } from "../../../apps/api/src/regional-values/issues/loadIssueSnapshot.js";
import { FIXTURE_LOGICAL_ROOT, REAL_LOGICAL_ROOT } from "../../../apps/api/src/regional-values/draft/types.js";
import type { RecordRoot } from "../../../apps/api/src/regional-values/draft/types.js";
import { FIXTURE_FACTS, hashOfName, passingCandidate, realFact, realSource, testCheckConfig, TEST_THEMES } from "./draftSupport.js";

/**
 * Test harness for the issues that a person approved (16.4 and after). Everything in it is
 * fictional or test-only: the lists of words are made-up markers, not the lists that a person
 * approves (13.1). A "world" is a temporary directory that stands for the place of a data kind, with
 * the records of the issues, the approval ledger, the fact items, the sources and the originals.
 */

export const ISSUE_SETTINGS: IssueSettings = { requiredApprovers: 1, checks: testCheckConfig(), themes: TEST_THEMES };

export function settingsWith(over: Partial<IssueSettings>): IssueSettings {
  return { ...ISSUE_SETTINGS, ...over };
}

export const ALL_CONFIRMED: IssueConfirmation = {
  factsMatch: true,
  factAndHypothesisSeparated: true,
  noCausalClaim: true,
  noRecommendation: true,
  unknownsStated: true,
  sourcesShown: true,
};

const CONTENT_FIELDS = [
  "themeId",
  "title",
  "statement",
  "basisFactIds",
  "factSummary",
  "background",
  "notDeterminable",
  "additionalChecks",
  "decisionScenes",
  "responseDirections",
] as const;

/** The record of a version of an issue, made from the output of a candidate that passes the checks. */
export function issueRecordFrom(
  candidate: Record<string, unknown>,
  options: Readonly<{ issueId: string; version?: number; dataKind: DataKind }>,
): IssueSourceRecord {
  const content: Record<string, unknown> = {};
  for (const field of CONTENT_FIELDS) {
    content[field] = candidate[field];
  }
  return IssueSourceRecordSchema.parse({
    ...content,
    issueId: options.issueId,
    version: options.version ?? 1,
    dataKind: options.dataKind,
    provenance: {
      aiInvolvement: "AI_DRAFT",
      draftId: hashOfName(`draft-${options.issueId}`),
      modelId: "test-model-1",
      promptVersion: "rv-draft-1",
      generatedAt: "2026-11-13T00:00:00Z",
      humanEdited: false,
    },
  });
}

/** An issue of fictional data on two fictional facts (`fx-1` and `fx-3` of `FIXTURE_FACTS`). */
export function fixtureIssue(issueId = "issue-1", version = 1, over: Record<string, unknown> = {}): IssueSourceRecord {
  return issueRecordFrom(passingCandidate(over), { issueId, version, dataKind: "FIXTURE" });
}

/** The output of a candidate on the one real fact `rf-1` (a statement without a number). */
export function realCandidate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    themeId: "TRANSPORT",
    title: "試験町の施設",
    statement: "施設の配置を確かめたい仮説語尾",
    basisFactIds: ["rf-1"],
    factSummary: [{ text: "試験町の施設は12か所である", groundFactIds: ["rf-1"] }],
    background: [],
    notDeterminable: ["利用者の数は資料だけでは分からない"],
    additionalChecks: ["施設ごとの利用状況を確認する"],
    decisionScenes: [],
    responseDirections: [{ label: "施設の見直し", description: "施設の配置を見直す方向", category: "CHANGE", status: "REFERENCE_ONLY" }],
    ...over,
  };
}

export function realIssue(issueId = "issue-r1", version = 1, over: Record<string, unknown> = {}): IssueSourceRecord {
  return issueRecordFrom(realCandidate(over), { issueId, version, dataKind: "REAL_AI" });
}

/** The bytes of the original that the real source and the real fact of the tests rest on. */
export const ORIGINAL_BYTES = new TextEncoder().encode("name,count\nfacility,12\n");
export const ORIGINAL_SHA256 = sha256Hex(ORIGINAL_BYTES);

export type IssueWorld = Readonly<{
  root: RecordRoot;
  inputs: IssueInputs;
  rawRoot: string;
  /** The fictional facts, as the registry `facts.json`. */
  setFixtureFacts: (facts: readonly FixtureFact[]) => Promise<void>;
  setRealFact: (fact: RealFact) => Promise<void>;
  setRealSource: (source: RealSource) => Promise<void>;
  /** The original of a real source, as a file of the directory of the original. */
  setOriginal: (source: RealSource, bytes: Uint8Array) => Promise<void>;
  addIssue: (record: IssueSourceRecord) => Promise<void>;
  approve: (issueId: string, version: number, approverId: string, at: string) => Promise<void>;
  /**
   * An approval as the ledger had it before the facts that an approval rests on were recorded: it names the record of the version and
   * has the six confirmations, and no `basisFacts`. The records of the ledger that exist are of this form.
   */
  approveWithoutBasis: (issueId: string, version: number, approverId: string, at: string) => Promise<void>;
  revoke: (issueId: string, version: number, revokerId: string, at: string) => Promise<void>;
  load: (settings?: IssueSettings) => ReturnType<typeof loadIssueSnapshot>;
  /** The whole tree of files, to see that a read changed nothing. */
  treeText: () => Promise<string>;
  remove: () => Promise<void>;
}>;

async function listTree(directory: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of [...entries].sort((first, second) => (first.name < second.name ? -1 : 1))) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await listTree(join(directory, entry.name), `${path}/`)));
    } else {
      found.push(`${path}\u0000${sha256Hex(await readFile(join(directory, entry.name)))}`);
    }
  }
  return found;
}

/** A world of one data kind in a temporary directory. The records are below `records/`, the originals below `raw/`. */
export async function createIssueWorld(dataKind: DataKind): Promise<IssueWorld> {
  const base = await mkdtemp(join(tmpdir(), "rv-issues-"));
  const root: RecordRoot = {
    dataKind,
    rootDir: join(base, "records"),
    logicalRoot: dataKind === "REAL_AI" ? REAL_LOGICAL_ROOT : FIXTURE_LOGICAL_ROOT,
  };
  const rawRoot = join(base, "raw");
  await mkdir(root.rootDir, { recursive: true });
  const inputs = createFileIssueInputs(root, { rawRoot });
  const store = createDraftStore(root);

  const writeJson = async (relativePath: string, value: unknown): Promise<void> => {
    const path = join(root.rootDir, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, encodeCanonicalJson(value));
  };
  const clockAt = (at: string) => (): Date => new Date(at);
  const added = new Map<string, IssueSourceRecord>();

  return {
    root,
    inputs,
    rawRoot,
    setFixtureFacts: (facts) => writeJson("facts.json", facts),
    setRealFact: (fact) => writeJson(`facts/${fact.factId}.json`, fact),
    setRealSource: (source) => writeJson(`sources/${source.sourceId}/${source.revision}.json`, source),
    setOriginal: async (source, bytes) => {
      const directory = join(rawRoot, source.sourceId, source.revision);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "original.csv"), bytes);
    },
    addIssue: async (record) => {
      const written = await writeImmutableRecord(root, `issues/${record.issueId}/v${record.version}.json`, record);
      if (!written.ok) {
        throw new Error(`The record of an issue was not written: ${written.error.code}`);
      }
      added.set(`${record.issueId}@${record.version}`, record);
    },
    approveWithoutBasis: async (issueId, version, approverId, at) => {
      const record = added.get(`${issueId}@${version}`);
      if (record === undefined) {
        throw new Error("The issue of the approval was not added");
      }
      const written = await appendLedgerRecord(
        root,
        ApprovalLedgerRecordSchema.parse({
          type: "APPROVE",
          targetKind: "ISSUE",
          targetId: issueId,
          targetHash: hashOf(record),
          targetVersion: version,
          approverId,
          approvedAt: new Date(at).toISOString(),
          issueChecks: ALL_CONFIRMED,
        }),
      );
      if (!written.ok) {
        throw new Error(`The approval was not written: ${written.error.code}`);
      }
    },
    approve: async (issueId, version, approverId, at) => {
      const result = await approveTarget(
        { store, now: clockAt(at) },
        { targetKind: "ISSUE", targetId: issueId, version, approverId, issueChecks: ALL_CONFIRMED },
      );
      if (!result.ok) {
        throw new Error(`The approval was not written: ${result.error.code}`);
      }
    },
    revoke: async (issueId, version, revokerId, at) => {
      const result = await revokeApproval({ store, now: clockAt(at) }, { targetKind: "ISSUE", targetId: issueId, version, revokerId });
      if (!result.ok) {
        throw new Error(`The revocation was not written: ${result.error.code}`);
      }
    },
    load: (settings = ISSUE_SETTINGS) => loadIssueSnapshot(inputs, settings),
    treeText: async () => (await listTree(base)).join("\n"),
    remove: () => rm(base, { recursive: true, force: true }),
  };
}

/** A real fact and a real source that agree with each other and with the original of the tests. */
export function realMaterial(over: Readonly<{ fact?: Record<string, unknown>; source?: Record<string, unknown> }> = {}): Readonly<{ fact: RealFact; source: RealSource }> {
  return {
    fact: realFact("rf-1", { sha256: ORIGINAL_SHA256, ...over.fact }),
    source: realSource({ sha256: ORIGINAL_SHA256, ...over.source }),
  };
}

export const FIXTURE_FACT_LIST: readonly FactItem[] = FIXTURE_FACTS;
