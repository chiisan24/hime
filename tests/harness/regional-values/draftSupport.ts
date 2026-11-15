import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DraftEventSchema,
  EvidenceUnitSchema,
  FixtureFactSchema,
  QuestionDraftOutputSchema,
  RealFactSchema,
  RealSourceSchema,
  ThemeDefSchema,
} from "@ehime-vote-navigator/contracts";
import { encodeCanonicalJson, sha256Hex } from "@ehime-vote-navigator/domain";
import type {
  ApprovalTargetKind,
  DataKind,
  DraftEvent,
  DraftTask,
  EvidenceUnit,
  FixtureFact,
  QuestionDraftOutput,
  RealFact,
  RealSource,
  ThemeDef,
  ThemeId,
} from "@ehime-vote-navigator/contracts";

import type { BedrockConverseClient, BedrockConverseError, BedrockConverseResult, ConverseRequest } from "../../../apps/api/src/aws/bedrockConverse.js";
import type { DraftCheckConfig, DraftCheckContext, DraftCheckWords } from "../../../apps/api/src/regional-values/draft/checks.js";
import { factNumeralsOf } from "../../../apps/api/src/regional-values/draft/checks.js";
import { createDraftStore } from "../../../apps/api/src/regional-values/draft/draftStore.js";
import type { DraftDeps } from "../../../apps/api/src/regional-values/draft/runDraft.js";
import type { DraftRequest } from "../../../apps/api/src/regional-values/draft/request.js";
import { FIXTURE_LOGICAL_ROOT, REAL_LOGICAL_ROOT } from "../../../apps/api/src/regional-values/draft/types.js";
import type { RecordRoot } from "../../../apps/api/src/regional-values/draft/types.js";
import { STANDARD_PREMISE, TEST_NEUTRALITY_CONFIG } from "./bankInjection.js";

/**
 * Test harness for the AI draft process (11.2 to 11.9). Everything in it is fictional or test-only:
 * the lists of words are not the lists that a person approves (13.1), and no fake of the model
 * reaches a network.
 */

/** Words of the lists that a person has yet to approve. They are made-up markers, so that no test depends on a real proposal. */
export const TEST_WORDS: DraftCheckWords = {
  causalWords: ["因果語"],
  hedgeEndings: ["仮説語尾"],
  comparisonWords: ["比較語"],
};

export const TEST_LIMITS = { maxEvidenceUnits: 10, evidenceMaxChars: 400 } as const;

export const TEST_MODELS = {
  generation: "jp.anthropic.claude-haiku-5-5",
  verification: "jp.anthropic.claude-opus-5-5",
} as const;

export const TEST_THEMES: readonly ThemeDef[] = (
  [
    ["TRANSPORT", "地域交通"],
    ["EDUCATION_CHILDCARE", "教育・子育て"],
    ["ECONOMY_EMPLOYMENT", "地域経済・雇用"],
    ["HEALTHCARE_WELFARE", "医療・福祉"],
    ["DISASTER_PREVENTION", "防災"],
    ["POPULATION_REVITALIZATION", "人口減少・地域活性化"],
  ] as const
).map(([themeId, label]) => ThemeDefSchema.parse({ themeId, label }));

export function testCheckConfig(): DraftCheckConfig {
  return {
    neutrality: TEST_NEUTRALITY_CONFIG,
    properNouns: ["架空市", "試験町"],
    sentenceMaxChars: 60,
    words: TEST_WORDS,
  };
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

export const FICTIONAL_SOURCE_ID = "fictional-doc-1";

export function fixtureFact(factId: string, over: Record<string, unknown> = {}): FixtureFact {
  return FixtureFactSchema.parse({
    dataKind: "FIXTURE",
    factId,
    sentence: "架空市のバス路線は12本である。",
    value: { amount: 12, unit: "本" },
    surveyDate: 2025,
    area: "架空市",
    fictionalSourceId: FICTIONAL_SOURCE_ID,
    ...over,
  });
}

/** Three fictional facts: two of the same unit, area and year (a comparison is allowed), and one of another unit. */
export const FIXTURE_FACTS: readonly FixtureFact[] = [
  fixtureFact("fx-1"),
  fixtureFact("fx-2", { sentence: "架空市のバス停は40か所である。", value: { amount: 40, unit: "か所" } }),
  fixtureFact("fx-3", { sentence: "架空市の鉄道路線は3本である。", value: { amount: 3, unit: "本" } }),
];

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

export function realSource(over: Record<string, unknown> = {}): RealSource {
  return RealSourceSchema.parse({
    dataKind: "REAL_AI",
    sourceId: "src-a",
    revision: "rev-1",
    reference: { kind: "url", url: "https://example.org/data/a.csv" },
    publisher: "試験公表者",
    publishedOn: "2026-01-01",
    retrievedAt: "2026-01-02T00:00:00Z",
    locator: { kind: "text-lines", startLine: 1, endLine: 10 },
    sha256: SHA_A,
    usage: { status: "CONFIRMED", checkedAt: "2026-01-02", checkedTarget: "利用条件のページ", evidence: "利用可と書かれている" },
    datasetNote: null,
    transmission: { status: "ALLOWED", checkedBy: "tester-1", checkedAt: "2026-01-02T00:00:00Z", evidence: "外部送信を許す条項がある" },
    license: { name: "試験ライセンス", url: "https://example.org/license" },
    ...over,
  });
}

export function realFact(factId: string, over: Record<string, unknown> = {}): RealFact {
  return RealFactSchema.parse({
    dataKind: "REAL_AI",
    factId,
    sentence: "試験町の施設は12か所である。",
    value: { amount: 12, unit: "か所" },
    surveyDate: 2025,
    area: "試験町",
    publisher: "試験公表者",
    sourceUrl: "https://example.org/data/a",
    datasetUrl: "https://example.org/data/a.csv",
    license: { name: "試験ライセンス", url: "https://example.org/license" },
    retrievedAt: "2026-01-02T00:00:00Z",
    sha256: SHA_A,
    locator: { kind: "text-lines", startLine: 3, endLine: 3 },
    method: { kind: "QUOTED", description: "表の値をそのまま引用した" },
    verification: { status: "VERIFIED", verifierId: "tester-1", verifiedAt: "2026-01-03T00:00:00Z" },
    ...over,
  });
}

export const REAL_SHA_A = SHA_A;
export const REAL_SHA_B = SHA_B;

export function evidenceUnit(evidenceId: string, text: string, sourceId: string = FICTIONAL_SOURCE_ID): EvidenceUnit {
  return EvidenceUnitSchema.parse({ evidenceId, sourceId, locator: { kind: "text-lines", startLine: 1, endLine: 2 }, text });
}

export const SUMMARY_EVIDENCE: EvidenceUnit = evidenceUnit("E1", "架空市では、2025年度にバス路線が12本運行された。路線ごとの利用状況は集計されていない。");

// ---------------------------------------------------------------------------
// Requests and passing outputs
// ---------------------------------------------------------------------------

/** A request of an issue candidate of fictional data, on the two facts that may be compared. */
export function candidateRequest(over: Partial<DraftRequest> = {}): DraftRequest {
  return {
    task: "ISSUE_CANDIDATE",
    dataKind: "FIXTURE",
    facts: [FIXTURE_FACTS[0] as FixtureFact, FIXTURE_FACTS[2] as FixtureFact],
    evidence: [],
    sources: [],
    ...over,
  };
}

export function summaryRequest(over: Partial<DraftRequest> = {}): DraftRequest {
  return { task: "ISSUE_SUMMARY", dataKind: "FIXTURE", facts: [], evidence: [SUMMARY_EVIDENCE], sources: [], ...over };
}

/** The output of a candidate that passes every check, with the words of the tests. */
export function passingCandidate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    themeId: "TRANSPORT",
    title: "架空市のバス路線",
    statement: "路線の本数と利用の関係を確かめたい仮説語尾",
    basisFactIds: ["fx-1", "fx-3"],
    factSummary: [
      { text: "架空市のバス路線は12本である", groundFactIds: ["fx-1"] },
      { text: "架空市の鉄道路線は3本である", groundFactIds: ["fx-3"] },
    ],
    background: [],
    notDeterminable: ["利用者の数は資料だけでは分からない"],
    additionalChecks: ["路線ごとの利用状況を確認する"],
    decisionScenes: [],
    responseDirections: [{ label: "路線の見直し", description: "路線の配置を見直す方向", category: "CHANGE", status: "REFERENCE_ONLY" }],
    ...over,
  };
}

export function passingSummary(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { sentences: [{ text: "2025年度にバス路線が12本運行された", groundIds: ["E1"] }], ...over };
}

/** A draft of a question made from a question of the passing bank of the tests (which passes every check). */
export function passingQuestionDraft(kind: QuestionDraftOutput["kind"], themeId: ThemeId = "TRANSPORT"): Record<string, unknown> {
  const common = { explanation: "", unsureLabel: "わからない", declineLabel: "回答しない" };
  const label = TEST_THEMES.find((theme) => theme.themeId === themeId)?.label ?? "";
  if (kind === "IMPORTANCE") {
    return {
      kind,
      themeId,
      ...common,
      explanation: `${label}は、地域の暮らしを支える分野のひとつです。ここでは、暮らしを考える材料として、あなたにとっての大切さをたずねます。`,
    };
  }
  if (kind === "TRADEOFF") {
    return {
      kind,
      themeId,
      ...common,
      text: `${label}について、限られた条件でどちらを先に進めたいですか`,
      explanation: `${label}の取り組みには、情報を届ける方法と、場所を整える方法があります。ここでは、両立が難しい場面での考えをたずねます。`,
      premise: STANDARD_PREMISE,
      directionA: { text: `${label}の情報を届ける取り組み`, category: "CHANGE" },
      directionB: { text: `${label}の場所を整える取り組み`, category: "CONTINUE" },
      opinionLabels: ["方向Aを強く優先", "方向Aをやや優先", "どちらも同じくらい大切", "方向Bをやや優先", "方向Bを強く優先"],
    };
  }
  return {
    kind,
    ...common,
    text: "あなたが先に進めたいと考える分野を選んでください",
    explanation:
      "複数の分野のうち、あなたが先に進めたいと考える分野を選びます。ここでは、暮らしの中で大切にしたい分野についての考えをたずねます。",
  };
}

/** The draft of a trade-off question that passes, as the typed output of the task. */
export function passingTradeoffDraft(themeId: ThemeId = "TRANSPORT"): Extract<QuestionDraftOutput, { kind: "TRADEOFF" }> {
  const parsed = QuestionDraftOutputSchema.parse(passingQuestionDraft("TRADEOFF", themeId));
  if (parsed.kind !== "TRADEOFF") {
    throw new Error("The draft of the test must be a trade-off question");
  }
  return parsed;
}

export function questionRequest(kind: "IMPORTANCE" | "TRADEOFF" | "PRIORITY_PICK", over: Partial<DraftRequest> = {}): DraftRequest {
  return {
    task: "QUESTION_DRAFT",
    dataKind: "FIXTURE",
    facts: [],
    evidence: [],
    sources: [],
    questionKind: kind,
    ...(kind === "PRIORITY_PICK" ? {} : { themeId: "TRANSPORT" as const }),
    ...over,
  };
}

/** The context of the checks that fits a request of fictional data. */
export function checkContextFor(request: DraftRequest, over: Partial<DraftCheckContext> = {}): DraftCheckContext {
  return {
    task: request.task,
    dataKind: request.dataKind,
    config: testCheckConfig(),
    evidence: request.evidence,
    facts: request.facts,
    themes: TEST_THEMES,
    factNumerals: factNumeralsOf(request.facts),
    today: "2026-11-13",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** A SHA-256 that is made from a name, so that a test can have as many draft IDs as it needs. */
export function hashOfName(name: string): string {
  return sha256Hex(new TextEncoder().encode(name));
}

type EventFields = Readonly<{
  at?: string;
  dataKind?: DataKind;
  task?: DraftTask;
  kind: DraftEvent["kind"];
  draftId?: string | null;
  reviewerId?: string;
  target?: { targetKind: ApprovalTargetKind; targetId: string };
}>;

/** A draft event with its ID. The kinds of the people get a reviewer and, for an adoption, a target, unless the test gives its own. */
export function eventOf(fields: EventFields): DraftEvent {
  const human = fields.kind.startsWith("HUMAN_");
  const adoption = fields.kind === "HUMAN_ADOPTED" || fields.kind === "HUMAN_EDITED";
  const draftId = fields.draftId === undefined ? hashOfName("draft-1") : fields.draftId;
  const raw = {
    at: fields.at ?? "2026-11-13T00:00:00Z",
    dataKind: fields.dataKind ?? "FIXTURE",
    task: fields.task ?? "ISSUE_SUMMARY",
    kind: fields.kind,
    draftId,
    ...(human ? { reviewerId: fields.reviewerId ?? "tester-1" } : {}),
    ...(adoption ? { target: fields.target ?? { targetKind: "CARD" as const, targetId: "card-1" } } : {}),
  };
  return DraftEventSchema.parse({ ...raw, eventId: sha256Hex(encodeCanonicalJson(raw)) });
}

// ---------------------------------------------------------------------------
// The fake of the model, the clock, the directory
// ---------------------------------------------------------------------------

export type FakeClient = Readonly<{
  client: BedrockConverseClient;
  /** What the process asked, in order. It is the only thing that proves "no call". */
  calls: ConverseRequest[];
}>;

/**
 * A client that answers from a script and counts what it was asked. A string is a response of the
 * model; an error is a failure of the client. The last answer is repeated when the script is short.
 */
export function createFakeClient(script: readonly (string | BedrockConverseError)[] | ((call: ConverseRequest, index: number) => string | BedrockConverseError)): FakeClient {
  const calls: ConverseRequest[] = [];
  const client: BedrockConverseClient = {
    converse: (request) => {
      const index = calls.length;
      calls.push(request);
      const answer =
        typeof script === "function" ? script(request, index) : (script[Math.min(index, script.length - 1)] ?? { code: "RESPONSE_INVALID" as const });
      const result: BedrockConverseResult =
        typeof answer === "string" ? { ok: true, value: { text: answer, status: 200, elapsedMs: 1 } } : { ok: false, error: answer };
      return Promise.resolve(result);
    },
  };
  return { client, calls };
}

/** A clock that moves forward by `stepMs` at each reading, so that two calls never have the same instant. */
export function createClock(startIso = "2026-11-13T00:00:00.000Z", stepMs = 7_000): () => Date {
  let current = Date.parse(startIso);
  return () => {
    const value = new Date(current);
    current += stepMs;
    return value;
  };
}

export type TempRoot = Readonly<{ root: RecordRoot; remove: () => Promise<void> }>;

/** A directory of its own that stands for the place of the data kind (the rule of the place is judged by the logical path). */
export async function createTempRoot(dataKind: DataKind): Promise<TempRoot> {
  const dir = await mkdtemp(join(tmpdir(), "rv-draft-"));
  return {
    root: { dataKind, rootDir: dir, logicalRoot: dataKind === "REAL_AI" ? REAL_LOGICAL_ROOT : FIXTURE_LOGICAL_ROOT },
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}

export type TestDeps = Readonly<{ deps: DraftDeps; waits: () => number }>;

/** The dependencies of `runDraft` with the fakes of the tests. `over` replaces any of them. */
export function createTestDeps(root: RecordRoot, client: BedrockConverseClient, over: Partial<DraftDeps> = {}): TestDeps {
  let waits = 0;
  const deps: DraftDeps = {
    client,
    store: createDraftStore(root),
    pacer: {
      wait: () => {
        waits += 1;
        return Promise.resolve();
      },
    },
    now: createClock(),
    models: TEST_MODELS,
    gate: { limits: TEST_LIMITS },
    isElectionBulletin: () => Promise.resolve(false),
    checks: testCheckConfig(),
    themes: TEST_THEMES,
    ...over,
  };
  return { deps, waits: () => waits };
}
