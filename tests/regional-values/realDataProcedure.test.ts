import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { RealFact } from "@ehime-vote-navigator/contracts";
import { sha256Hex } from "@ehime-vote-navigator/domain";
import { afterEach, describe, expect, it } from "vitest";

import { runRegionalValuesCli } from "../../apps/api/src/regional-values/cli.js";
import { createDraftStore } from "../../apps/api/src/regional-values/draft/draftStore.js";
import { defaultRecordRoot } from "../../apps/api/src/regional-values/draft/types.js";
import { readRealFacts } from "../../apps/api/src/regional-values/intake/factValue.js";
import { readRealSources } from "../../apps/api/src/regional-values/intake/sourceRecords.js";
import { recordSourceReview } from "../../apps/api/src/regional-values/intake/sourceReview.js";
import type { SourceReviewUpdate } from "../../apps/api/src/regional-values/intake/sourceReview.js";
import { createBuildWorkspace } from "../harness/regional-values/buildWorkspace.js";
import type { BuildWorkspace } from "../harness/regional-values/buildWorkspace.js";
import { TEST_MODELS, TEST_THEMES, TEST_WORDS, createClock, createFakeClient, passingCandidate } from "../harness/regional-values/draftSupport.js";
import type { FakeClient } from "../harness/regional-values/draftSupport.js";
import { COUNT_ROWS, FACT_TABLE } from "../harness/regional-values/factSupport.js";
import { FAST_OPERATIONS, FICTIONAL_CATALOG, FICTIONAL_LICENSE, createIntakeWorld, expectedOf } from "../harness/regional-values/intakeSupport.js";
import type { IntakeWorld } from "../harness/regional-values/intakeSupport.js";
import { encodeUtf8 } from "../harness/regional-values/shiftJis.js";

/**
 * A rehearsal of the procedure for the first real data set (`records/real-data-first-dataset-procedure.md`), with a fictional data set,
 * fictional files and a fake of the model. Nothing here reaches a network, and nothing is read from or written to the repository: the
 * files are made in a temporary workspace where the commands look for the records of real data.
 *
 * What it shows is the order of the procedure and who decides what. The commands take a file in, make a fact item and compare an
 * original, and they decide nothing: a review of the terms of use or of the sending to an external AI, and the verification of a fact item,
 * are a person's. Where the procedure needs a person, the test is the person, with the same function that a script of a person would
 * call (`recordSourceReview`) or with the answers to the questions of `verify-fact`. Until the person has decided, `draft run` refuses, and
 * the model is not called.
 */

const FIXED_NOW = new Date("2026-11-20T01:00:00.000Z");
/** Stands for the XLSX file that the publisher offers: the bytes of the original, which a person converts to a CSV by hand. */
const ORIGINAL = encodeUtf8("fictional bytes of an xlsx file (not a real file)");
const ORIGINAL_EXPECTED = expectedOf(ORIGINAL);
const PROCEDURE = encodeUtf8("手順書(架空): 1. 開く 2. UTF-8のCSVで保存 3. 行数を確かめる");
const CSV = encodeUtf8(FACT_TABLE);
const CSV_SHA = sha256Hex(CSV);

const DATASET = {
  title: "架空の避難所一覧",
  sourceUrl: "https://example.org/dataset/shelters",
  surveyDate: "2026-07-27",
  updatedOn: "2026-07-27",
  coverageArea: "架空県",
  themeIds: ["DISASTER_PREVENTION"],
};

const SETTINGS = {
  maxEvidenceUnits: 10,
  evidenceMaxChars: 400,
  sentenceMaxChars: 60,
  causalWords: [...TEST_WORDS.causalWords],
  hedgeEndings: [...TEST_WORDS.hedgeEndings],
  comparisonWords: [...TEST_WORDS.comparisonWords],
  themes: TEST_THEMES,
};

/** What a person decides about the terms of use and the sending, as the records ask for it (fictional evidence). */
const USAGE_CONFIRMED: SourceReviewUpdate = {
  usage: { status: "CONFIRMED", checkedAt: "2026-11-03", checkedTarget: "架空の利用規約", evidence: "架空の規約に、利用できると書かれている" },
};
const SENDING_ALLOWED: SourceReviewUpdate = {
  transmission: { status: "ALLOWED", checkedBy: "reviewer-1", checkedAt: "2026-11-03T00:00:00Z", evidence: "架空の規約に、外部の処理を制限する条項がない" },
};
const SENDING_DENIED: SourceReviewUpdate = {
  transmission: { status: "DENIED", checkedBy: "reviewer-1", checkedAt: "2026-11-03T00:00:00Z", evidence: "架空の規約が、外部の処理を認めていない" },
};

type Rehearsal = Readonly<{ workspace: BuildWorkspace; world: IntakeWorld; fake: FakeClient }>;

let rehearsal: Rehearsal | undefined;
/** What the fake of the model answers. */
let modelAnswer = "{}";

afterEach(async () => {
  await rehearsal?.world.remove();
  await rehearsal?.workspace.remove();
  rehearsal = undefined;
  modelAnswer = "{}";
});

function ctx(): Rehearsal {
  if (rehearsal === undefined) {
    throw new Error("prepare the workspace first");
  }
  return rehearsal;
}

/** A file in the workspace, given to a command by a path from the root of the repository. */
async function put(path: string, content: unknown): Promise<void> {
  const absolute = join(ctx().workspace.root, ...path.split("/"));
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content instanceof Uint8Array || typeof content === "string" ? content : JSON.stringify(content));
}

async function prepare(): Promise<Rehearsal> {
  const workspace = await createBuildWorkspace();
  const world = await createIntakeWorld({ base: workspace.root });
  rehearsal = { workspace, world, fake: createFakeClient(() => modelAnswer) };
  await put("inbox/draft-settings.json", SETTINGS);
  return rehearsal;
}

type Run = Readonly<{ exitCode: number; lines: string[]; asked: string[] }>;

/** One command of the procedure. `answers` are the answers of the person to the questions that the command asks (the answer is no after them). */
async function cli(argv: readonly string[], answers: readonly boolean[] = []): Promise<Run> {
  const { workspace, fake } = ctx();
  const lines: string[] = [];
  const asked: string[] = [];
  const exitCode = await runRegionalValuesCli(argv, {
    workspaceRoot: workspace.root,
    io: {
      write: (line) => lines.push(line),
      confirm: (question: string) => {
        asked.push(question);
        return Promise.resolve(answers[asked.length - 1] === true);
      },
    },
    now: createClock(FIXED_NOW.toISOString(), 1_000),
    logWriter: () => undefined,
    real: { operations: FAST_OPERATIONS },
    verifyFact: { operations: FAST_OPERATIONS },
    draft: {
      client: fake.client,
      pacer: { wait: () => Promise.resolve() },
      models: TEST_MODELS,
      isElectionBulletin: () => Promise.resolve(false),
    },
  });
  return { exitCode, lines, asked };
}

// ---------------------------------------------------------------------------
// The steps of the procedure
// ---------------------------------------------------------------------------

/** Step 1: the original that the person has is the expected one. */
function verifyOriginal(sha256: string = ORIGINAL_EXPECTED.sha256, bytes: number = ORIGINAL.byteLength): readonly string[] {
  return ["real", "original", "verify-file", "--file", "inbox/shelters.xlsx", "--expected-sha256", sha256, "--expected-bytes", String(bytes)];
}

const INTAKE = ["real", "intake", "csv", "--request", "inbox/intake.json"] as const;
const SOURCE = { sourceId: "fictional-shelters", revision: "r1" } as const;

/** Step 2: the files that a person gives (the CSV that was converted by hand, the procedure, the request). */
async function putFilesOfIntake(over: Record<string, unknown> = {}, conversion: Record<string, unknown> = {}): Promise<void> {
  await put("inbox/shelters.xlsx", ORIGINAL);
  await put("inbox/shelters.csv", CSV);
  await put("inbox/procedure.md", PROCEDURE);
  await put("inbox/intake.json", {
    sourceId: "fictional-shelters",
    file: "inbox/shelters.csv",
    reference: { kind: "url", url: "https://example.org/dataset/shelters" },
    publisher: "架空県",
    publishedOn: "2026-07-27",
    retrievedAt: "2026-11-01T00:00:00Z",
    license: FICTIONAL_LICENSE,
    catalog: FICTIONAL_CATALOG,
    // The SHA-256 and the size of the original that was converted (the XLSX), not of the CSV that was made from it.
    expectedOriginal: ORIGINAL_EXPECTED,
    conversion: {
      originalFile: "inbox/shelters.xlsx",
      procedureId: "xlsx-to-csv-by-hand-v1",
      procedureFile: "inbox/procedure.md",
      convertedBy: "analyst-1",
      convertedAt: "2026-11-02T09:00:00Z",
      correspondence: "ROWS_PRESERVED",
      // The rows of the original with the header (a header and four rows of data): the intake counts the rows of the CSV in the same way.
      originalRowCount: 5,
      ...conversion,
    },
    dataset: DATASET,
    ...over,
  });
}

/** Step 3: the fact item. It is made PROVISIONAL, and nothing in the command verifies it. */
const FACT_REQUEST = {
  kind: "COMPUTED",
  factId: "fact-rows",
  sourceId: "fictional-shelters",
  method: COUNT_ROWS,
  surveyDate: "2026-07-27",
  area: "架空県",
  subject: "避難所の記録の数",
  unit: "件",
};

async function takeIn(): Promise<void> {
  await putFilesOfIntake();
  const taken = await cli(INTAKE);
  expect(taken.exitCode, taken.lines.join(" | ")).toBe(0);
}

async function makeFact(): Promise<RealFact> {
  await put("inbox/fact.json", FACT_REQUEST);
  const made = await cli(["real", "fact", "create", "--request", "inbox/fact.json"]);
  expect(made.exitCode, made.lines.join(" | ")).toBe(0);
  const facts = await readRealFacts(ctx().world.store);
  const fact = facts.ok ? facts.value.find((item) => item.factId === "fact-rows") : undefined;
  if (fact === undefined) {
    throw new Error("the fact item was expected to be made");
  }
  return fact;
}

async function verificationsOfFacts(): Promise<readonly string[]> {
  const facts = await readRealFacts(ctx().world.store);
  return facts.ok ? facts.value.map((fact) => fact.verification.status) : [];
}

/** The request of `draft run` is made from the two records, as the script of a person would make it. No command makes it. */
async function putDraftRequest(): Promise<void> {
  const facts = await readRealFacts(ctx().world.store);
  const sources = await readRealSources(ctx().world.store);
  if (!facts.ok || !sources.ok) {
    throw new Error("the records were expected to be readable");
  }
  await put("inbox/draft-request.json", { dataKind: "REAL_AI", facts: facts.value, factRegistry: facts.value, evidence: [], sources: sources.value });
}

const DRAFT_RUN = ["draft", "run", "--task", "ISSUE_CANDIDATE", "--input", "inbox/draft-request.json", "--draft-settings", "inbox/draft-settings.json"] as const;

async function draftRun(): Promise<Run> {
  await putDraftRequest();
  return cli(DRAFT_RUN);
}

/** What the fake of the model writes for the fact item: a hypothesis that the checks of the test-only lists accept. */
function candidateFor(fact: RealFact): string {
  return JSON.stringify(
    passingCandidate({
      themeId: "DISASTER_PREVENTION",
      title: "避難所の記録の数",
      statement: "避難所の記録の数を確かめたい仮説語尾",
      basisFactIds: [fact.factId],
      factSummary: [{ text: fact.sentence, groundFactIds: [fact.factId] }],
      responseDirections: [],
    }),
  );
}

/** What a person does with a review. The command line has no command for it: the function is what a script of a person calls. */
async function personReviews(update: SourceReviewUpdate): Promise<void> {
  const written = await recordSourceReview(ctx().world.store, SOURCE, update);
  expect(written.ok).toBe(true);
}

const REFUSED = "code=DRAFT_FAILED reason=INPUT_REFUSED";

// ---------------------------------------------------------------------------

describe("the procedure for the first real data set, from the original to the gate of the draft", () => {
  it("goes through the steps in order, and every decision in it is a person's", async () => {
    const { world, fake, workspace } = await prepare();

    // 1. [command] The original that the person has is the one that was expected: the SHA-256 and the size. Nothing is written.
    await put("inbox/shelters.xlsx", ORIGINAL);
    expect(await cli(verifyOriginal())).toMatchObject({
      exitCode: 0,
      lines: [`file sha256=${ORIGINAL_EXPECTED.sha256} bytes=${ORIGINAL.byteLength}`, "code=ORIGINAL_MATCH"],
    });
    expect(await world.files()).toEqual([]);

    // 2. [person] The CSV is made from the original by hand, row for row, with a written procedure. [command] It is taken in with the
    // record of the conversion and the ledger of the data set, and the original that was converted is compared with the expected one.
    await putFilesOfIntake();
    const intake = await cli(INTAKE);
    expect(intake.exitCode, intake.lines.join(" | ")).toBe(0);
    expect(intake.lines[0]).toContain(`code=INTAKE_OK status=CREATED sourceId=fictional-shelters revision=r1 sha256=${CSV_SHA}`);
    expect(intake.lines[0]).toContain("rows=4 columns=4");
    expect(intake.lines[0]).toContain("ledger=CREATED");
    expect(await cli(["real", "original", "verify-stored"])).toMatchObject({ exitCode: 0, lines: [expect.stringContaining("state=MATCH"), "code=ORIGINALS_OK count=1"] });
    expect((await cli(["real", "dataset", "check"])).lines).toEqual(["code=DATASET_CHECK_OK datasets=1 sources=1"]);

    // What the commands left undecided: the terms of use, the note of the data set, the sending, and the adoption.
    expect(await world.readJson(world.recordPath("sources/fictional-shelters/r1.json"))).toMatchObject({
      sha256: CSV_SHA,
      usage: { status: "UNKNOWN" },
      datasetNote: null,
      transmission: { status: "UNKNOWN" },
      conversion: { originalSha256: ORIGINAL_EXPECTED.sha256, convertedSha256: CSV_SHA, convertedBy: "analyst-1", originalRowCount: 5, convertedRowCount: 5 },
    });
    expect((await cli(["real", "dataset", "list"])).lines[0]).toContain("adoption=CANDIDATE usage=UNKNOWN note=UNCHECKED transmission=UNKNOWN");

    // 3. [command] The fact item is made from the original, PROVISIONAL. It does not count as verified yet.
    const fact = await makeFact();
    expect(fact.verification).toEqual({ status: "PROVISIONAL" });
    expect(fact.value).toEqual({ amount: 4, unit: "件" });
    const status = await cli(["real", "fact", "status"]);
    expect(status.exitCode).toBe(1);
    expect(status.lines.at(-1)).toBe("code=FACT_STATUS_NOT_VERIFIED count=1 notVerified=1");

    // 4. The gate of the draft refuses everything that is not decided, with every reason, and the model is not called.
    modelAnswer = candidateFor(fact);
    expect(await draftRun()).toMatchObject({ exitCode: 1, lines: [REFUSED, "reasons=FACT_NOT_VERIFIED,USAGE_NOT_CONFIRMED,TRANSMISSION_NOT_ALLOWED"] });
    expect(fake.calls).toHaveLength(0);

    // 5. [person] The person compares the stored value with the value computed again from the original, and says yes twice. A yes and a no verifies nothing.
    const cancelled = await cli(["verify-fact", "fact-rows", "--verifier", "verifier-1"], [true, false]);
    expect(cancelled.exitCode).toBe(1);
    expect(cancelled.lines.at(-1)).toBe("code=VERIFY_FAILED reason=CANCELLED");
    expect(await verificationsOfFacts()).toEqual(["PROVISIONAL"]);
    const verified = await cli(["verify-fact", "fact-rows", "--verifier", "verifier-1"], [true, true]);
    expect(verified.exitCode).toBe(0);
    expect(verified.lines.at(-1)).toBe("code=VERIFY_OK factId=fact-rows");
    expect((await cli(["real", "fact", "status"])).lines.at(-1)).toBe("code=FACT_STATUS_OK count=1");
    expect(await draftRun()).toMatchObject({ exitCode: 1, lines: [REFUSED, "reasons=USAGE_NOT_CONFIRMED,TRANSMISSION_NOT_ALLOWED"] });

    // 6. [person] The terms of use are confirmed. The sending is not decided yet, and a no to the sending refuses the input as well.
    await personReviews(USAGE_CONFIRMED);
    expect(await draftRun()).toMatchObject({ exitCode: 1, lines: [REFUSED, "reasons=TRANSMISSION_NOT_ALLOWED"] });
    await personReviews(SENDING_DENIED);
    expect(await draftRun()).toMatchObject({ exitCode: 1, lines: [REFUSED, "reasons=TRANSMISSION_NOT_ALLOWED"] });
    expect(fake.calls).toHaveLength(0);

    // 7. [person] The sending is allowed for this data set. Only now does the gate let the input through, and the model (a fake) is asked once.
    await personReviews(SENDING_ALLOWED);
    const drafted = await draftRun();
    expect(drafted.exitCode).toBe(0);
    expect(drafted.lines).toEqual([expect.stringMatching(/^code=DRAFT_OK draftId=[0-9a-f]{64} task=ISSUE_CANDIDATE cached=false$/u)]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.modelId).toBe(TEST_MODELS.generation);
    // The instruction names the endings and the words of the settings that judge the output (the settings of this test).
    expect(fake.calls[0]?.system).toContain("「仮説語尾」");
    expect(fake.calls[0]?.system).toContain("「因果語」");
    expect(fake.calls[0]?.text).toContain("factId: fact-rows");

    // 8. The draft waits for a person: it is PENDING, a proposal, and no approval was written. The adoption and the approval are not in this procedure.
    const listed = await cli(["draft", "list", "--data-kind", "REAL_AI"]);
    expect(listed.lines).toEqual(expect.arrayContaining([expect.stringMatching(/^candidate=[0-9a-f]{64} status=PENDING model=/u), "code=LIST_OK count=1"]));
    const stored = await createDraftStore(defaultRecordRoot(workspace.root, "REAL_AI")).loadDrafts();
    expect(stored.ok && stored.value[0]).toMatchObject({
      dataKind: "REAL_AI",
      aiClass: "AI_DRAFT",
      inputSources: [{ sourceId: "fictional-shelters", revision: "r1", sha256: CSV_SHA }],
    });
    expect((await world.files()).some((path) => path.includes("approvals"))).toBe(false);
  });

  it("does not take a review that was not made for one that was, whatever the commands before it did", async () => {
    const { fake } = await prepare();
    await takeIn();
    const fact = await makeFact();
    await cli(["verify-fact", "fact-rows", "--verifier", "verifier-1"], [true, true]);
    modelAnswer = candidateFor(fact);

    // Every command of the procedure was run and the fact item is verified; nothing about the terms of use or the sending was decided.
    expect(await draftRun()).toMatchObject({ exitCode: 1, lines: [REFUSED, "reasons=USAGE_NOT_CONFIRMED,TRANSMISSION_NOT_ALLOWED"] });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("where the procedure stops", () => {
  it("stops at an original that is not the expected one: nothing is taken in, and the person is told which item differs", async () => {
    const { world } = await prepare();
    await put("inbox/shelters.xlsx", ORIGINAL);

    expect(await cli(verifyOriginal("5".repeat(64)))).toMatchObject({ exitCode: 1, lines: [expect.stringContaining("sha256="), "code=ORIGINAL_MISMATCH fields=sha256"] });
    expect(await cli(verifyOriginal(ORIGINAL_EXPECTED.sha256, ORIGINAL.byteLength + 1))).toMatchObject({
      exitCode: 1,
      lines: [expect.stringContaining("sha256="), "code=ORIGINAL_MISMATCH fields=byteLength"],
    });

    await putFilesOfIntake({ expectedOriginal: { sha256: "5".repeat(64), byteLength: ORIGINAL.byteLength } });
    expect(await cli(INTAKE)).toMatchObject({ exitCode: 1, lines: ["code=INTAKE_FAILED reason=ORIGINAL_MISMATCH fields=sha256"] });
    expect(await world.files()).toEqual([]);
  });

  it("stops at a conversion that does not keep the rows, and at the CSV that is given as the original", async () => {
    const { world } = await prepare();

    await putFilesOfIntake({}, { originalRowCount: 7 });
    const rows = await cli(INTAKE);
    expect(rows.exitCode).toBe(1);
    expect(rows.lines.join(" | ")).toBe("code=INTAKE_FAILED reason=ROW_COUNT_MISMATCH originalRows=7 convertedRows=5");

    // The expected original is the file that was converted: the SHA-256 and the size of the CSV are not the ones to give.
    await putFilesOfIntake({ expectedOriginal: expectedOf(CSV) });
    const given = await cli(INTAKE);
    expect(given.exitCode).toBe(1);
    expect(given.lines.join(" | ")).toBe("code=INTAKE_FAILED reason=ORIGINAL_MISMATCH fields=sha256,byteLength");
    expect(await world.files()).toEqual([]);
  });

  it("stops when the original that was taken in is changed afterwards: the comparison and the state of the fact item both say so", async () => {
    const { world } = await prepare();
    await takeIn();
    await makeFact();
    await cli(["verify-fact", "fact-rows", "--verifier", "verifier-1"], [true, true]);

    await writeFile(world.rawPath("fictional-shelters/r1/shelters.csv"), encodeUtf8("地区,件数\nあおば,1\n"));

    const stored = await cli(["real", "original", "verify-stored"]);
    expect(stored.exitCode).toBe(1);
    expect(stored.lines.at(-1)).toBe("code=ORIGINALS_NOT_MATCHING changed=1 missing=0");
    const status = await cli(["real", "fact", "status"]);
    expect(status.exitCode).toBe(1);
    expect(status.lines[0]).toContain("effective=PROVISIONAL");
    expect(status.lines[0]).toContain("findings=SOURCE_CHANGED");
  });

  it("stops at a fact item that was not verified by two yes: nothing is written", async () => {
    await prepare();
    await takeIn();
    await makeFact();

    for (const answers of [[], [false], [true, false], [false, true]] as const) {
      const result = await cli(["verify-fact", "fact-rows", "--verifier", "verifier-1"], answers);
      expect(result.exitCode, JSON.stringify(answers)).toBe(1);
      expect(result.lines.at(-1)).toBe("code=VERIFY_FAILED reason=CANCELLED");
    }
    expect(await verificationsOfFacts()).toEqual(["PROVISIONAL"]);
  });
});
