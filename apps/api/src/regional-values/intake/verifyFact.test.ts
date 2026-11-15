import { readdir, readFile, unlink, writeFile } from "node:fs/promises";

import { RealFactSchema } from "@ehime-vote-navigator/contracts";
import type { RealFact } from "@ehime-vote-navigator/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  CLOCK,
  COUNT_FLOOD,
  COUNT_ROWS,
  SUM_POPULATION,
  SUM_SHELTERS,
  computedRequest,
  createVerifiedFact,
  fakeHuman,
  takeInTable,
} from "../../../../../tests/harness/regional-values/factSupport.js";
import { createIntakeWorld, failRenameTo } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import type { IntakeWorld } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import { encodeUtf8 } from "../../../../../tests/harness/regional-values/shiftJis.js";
import { createComputedFact, createDerivedFact, createQuotedFact } from "./factValue.js";
import { VERIFY_QUESTIONS, verificationLines, verifyFact } from "./verifyFact.js";
import type { VerifyFactDeps } from "./verifyFact.js";

// The people here are functions that answer the questions as a test says. The code never answers for a person.

let world: IntakeWorld | undefined;

async function newWorld(): Promise<IntakeWorld> {
  world = await createIntakeWorld();
  return world;
}

afterEach(async () => {
  await world?.remove();
  world = undefined;
});

function factText(current: IntakeWorld, id: string): Promise<string> {
  return current.readText(current.recordPath(`facts/${id}.json`));
}

type Session = Readonly<{ lines: string[]; events: string[]; deps: VerifyFactDeps; asked: () => readonly string[] }>;

/** A session with a fake person. `events` is the order of what was shown and what was asked. */
function session(answers: readonly boolean[]): Session {
  const human = fakeHuman(answers);
  const lines: string[] = [];
  const events: string[] = [];
  return {
    lines,
    events,
    asked: () => human.asked,
    deps: {
      now: CLOCK,
      write: (line) => {
        lines.push(line);
        events.push(`line:${line}`);
      },
      confirm: async (question) => {
        events.push(`ask:${question}`);
        return human.confirm(question);
      },
    },
  };
}

async function makeFact(current: IntakeWorld, over: Parameters<typeof computedRequest>[0] = {}): Promise<RealFact> {
  const result = await createComputedFact(current.store, computedRequest(over));
  if (!result.ok) {
    throw new Error(`The fact item was refused: ${result.error.code}`);
  }
  return result.value.fact;
}

describe("verifyFact: a person says that the fact item is right", () => {
  it("writes VERIFIED with the person and the time, and changes nothing else in the fact item", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const before = await makeFact(current);
    const talk = session([true, true]);
    const result = await verifyFact(current.store, { factId: "fact-rows", verifierId: "verifier-1" }, talk.deps);
    expect(result.ok && result.value.status).toBe("VERIFIED");
    const after = RealFactSchema.parse(await current.readJson(current.recordPath("facts/fact-rows.json")));
    expect(after).toEqual({ ...before, verification: { status: "VERIFIED", verifierId: "verifier-1", verifiedAt: "2026-11-13T00:00:00.000Z" } });
    expect(result.ok && result.value.status === "VERIFIED" && result.value.fact).toEqual(after);
  });

  it("asks the two questions, in order, after it has shown the numbers", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current);
    const talk = session([true, true]);
    await verifyFact(current.store, { factId: "fact-rows", verifierId: "verifier-1" }, talk.deps);
    expect(talk.asked()).toEqual([...VERIFY_QUESTIONS.value]);
    const firstAsk = talk.events.findIndex((event) => event.startsWith("ask:"));
    expect(firstAsk).toBeGreaterThan(0);
    expect(talk.events.slice(0, firstAsk).every((event) => event.startsWith("line:"))).toBe(true);
    expect(talk.events.slice(0, firstAsk)).toContain("line:stored amount=4 unit=件");
  });

  it("shows the stored value, the value that is computed again, the place, the blank cells and the rows left out", async () => {
    const current = await newWorld();
    const source = await takeInTable(current);
    await makeFact(current);
    const talk = session([false]);
    await verifyFact(current.store, { factId: "fact-rows", verifierId: "verifier-1" }, talk.deps);
    expect(talk.lines).toEqual([
      "fact=fact-rows method=COMPUTED aggregation=COUNT_ROWS status=PROVISIONAL",
      `source sourceId=fictional-shelters revision=r1 sha256=${source.sha256}`,
      "survey=2026-07-27 area=架空県",
      "stored amount=4 unit=件",
      "recomputed amount=4 unit=件 missingCount=0 duplicatesRemoved=0",
      "record missingCount=0 duplicatesRemoved=0",
      "locator kind=text-lines startLine=2 endLine=5",
      "sentence=架空県の避難所の記録の数は、2026年7月27日時点で4件です。",
    ]);
  });

  it("shows the number of blank cells of a sum", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current, { method: SUM_POPULATION, subject: "人口", unit: undefined });
    const talk = session([false]);
    await verifyFact(current.store, { factId: "fact-rows", verifierId: "verifier-1" }, talk.deps);
    expect(talk.lines).toContain("recomputed amount=2300 unit=人 missingCount=1 duplicatesRemoved=0");
    expect(talk.lines).toContain("record missingCount=1 duplicatesRemoved=0");
  });

  it("shows the number of rows that were left out as the same row", async () => {
    const current = await newWorld();
    await takeInTable(current, "地区,件数\nあおば,1\nあおば,1\nみなと,2\nみなと,2\nひなた,3\n");
    await makeFact(current, { method: { ...COUNT_ROWS, dedupeColumns: ["地区"] } });
    const talk = session([false]);
    await verifyFact(current.store, { factId: "fact-rows", verifierId: "verifier-1" }, talk.deps);
    expect(talk.lines).toContain("recomputed amount=3 unit=件 missingCount=0 duplicatesRemoved=2");
    expect(talk.lines).toContain("record missingCount=0 duplicatesRemoved=2");
  });

  it("shows no row of the original: no value of a cell", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current, { method: SUM_SHELTERS, subject: "避難所の数", unit: "か所" });
    const talk = session([false]);
    await verifyFact(current.store, { factId: "fact-rows", verifierId: "verifier-1" }, talk.deps);
    const shown = talk.lines.join("\n");
    for (const cell of ["あおば", "みなと", "ひなた", "洪水", "地震", "1200人"]) {
      expect(shown).not.toContain(cell);
    }
  });
});

describe("verifyFact: it does not verify without an explicit yes", () => {
  async function unverified(): Promise<Readonly<{ current: IntakeWorld; text: string }>> {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current);
    return { current, text: await factText(current, "fact-rows") };
  }

  it.each([
    ["no to the first question", [false], 1],
    ["no to the second question", [true, false], 2],
    ["no answer at all (the input is closed)", [], 1],
    ["no to both", [false, false], 1],
  ])("writes nothing for %s", async (_name, answers, asked) => {
    const { current, text } = await unverified();
    const talk = session(answers);
    const result = await verifyFact(current.store, { factId: "fact-rows", verifierId: "verifier-1" }, talk.deps);
    expect(result).toEqual({ ok: false, error: { code: "CANCELLED" } });
    expect(talk.asked()).toHaveLength(asked);
    expect(await factText(current, "fact-rows")).toBe(text);
    expect(RealFactSchema.parse(JSON.parse(text)).verification.status).toBe("PROVISIONAL");
  });

  it("writes nothing when the question cannot be asked (the input fails)", async () => {
    const { current, text } = await unverified();
    const result = await verifyFact(
      current.store,
      { factId: "fact-rows", verifierId: "verifier-1" },
      {
        now: CLOCK,
        write: () => undefined,
        confirm: () => Promise.reject(new Error("the input is closed")),
      },
    );
    expect(result).toEqual({ ok: false, error: { code: "CANCELLED" } });
    expect(await factText(current, "fact-rows")).toBe(text);
  });

  it.each([["y"], ["yes"], [1], ["true"], [undefined], [null], [{}]])("takes %j for a no: only the boolean true is a yes", async (answer) => {
    const { current, text } = await unverified();
    const result = await verifyFact(
      current.store,
      { factId: "fact-rows", verifierId: "verifier-1" },
      { now: CLOCK, write: () => undefined, confirm: () => Promise.resolve(answer as unknown as boolean) },
    );
    expect(result).toEqual({ ok: false, error: { code: "CANCELLED" } });
    expect(await factText(current, "fact-rows")).toBe(text);
  });

  it("does not verify when the person answers yes to the first question only", async () => {
    const { current } = await unverified();
    const talk = session([true]);
    const result = await verifyFact(current.store, { factId: "fact-rows", verifierId: "verifier-1" }, talk.deps);
    expect(result.ok).toBe(false);
    expect(talk.asked()).toEqual([...VERIFY_QUESTIONS.value]);
  });
});

describe("verifyFact: a fact item that does not pass the checks is not offered", () => {
  /** Writes the fact item as a person would edit it by hand. */
  async function edit(current: IntakeWorld, id: string, change: (fact: RealFact) => unknown): Promise<void> {
    const fact = RealFactSchema.parse(await current.readJson(current.recordPath(`facts/${id}.json`)));
    await current.putRecord(`facts/${id}.json`, change(fact));
  }

  async function refused(current: IntakeWorld, id = "fact-rows") {
    const talk = session([true, true]);
    const text = await factText(current, id);
    const result = await verifyFact(current.store, { factId: id, verifierId: "verifier-1" }, talk.deps);
    expect(talk.asked()).toEqual([]);
    expect(await factText(current, id)).toBe(text);
    expect(result.ok).toBe(false);
    return { result, lines: talk.lines };
  }

  it("refuses a stored value that is not the value that the original gives, and shows both", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current);
    await edit(current, "fact-rows", (fact) => ({ ...fact, value: { amount: 5, unit: "件" } }));
    const { result, lines } = await refused(current);
    expect(result).toEqual({ ok: false, error: { code: "CHECK_FAILED", findings: ["FACT_VALUE_MISMATCH"], problems: [] } });
    expect(lines).toContain("stored amount=5 unit=件");
    expect(lines).toContain("recomputed amount=4 unit=件 missingCount=0 duplicatesRemoved=0");
  });

  it("refuses a stored value and a sentence that agree with each other and not with the original", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current);
    await edit(current, "fact-rows", (fact) => ({ ...fact, value: { amount: 5, unit: "件" }, sentence: fact.sentence.replace("4件", "5件") }));
    const { result } = await refused(current);
    expect(result.ok === false && result.error.findings).toEqual(["FACT_VALUE_MISMATCH"]);
    expect(result.ok === false && result.error.problems).toEqual(["SENTENCE_VALUE_NOT_WRITTEN", "SENTENCE_NUMBER_NOT_GROUNDED"]);
  });

  it("refuses a sentence whose number is not the value, and names the reason", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current);
    await edit(current, "fact-rows", (fact) => ({ ...fact, sentence: fact.sentence.replace("4件", "5件") }));
    const { result } = await refused(current);
    expect(result).toEqual({
      ok: false,
      error: { code: "CHECK_FAILED", findings: ["FACT_VALUE_MISMATCH"], problems: ["SENTENCE_VALUE_NOT_WRITTEN", "SENTENCE_NUMBER_NOT_GROUNDED"] },
    });
  });

  it("refuses a date in the sentence that is not the survey date", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current);
    await edit(current, "fact-rows", (fact) => ({ ...fact, sentence: fact.sentence.replace("7月27日", "7月28日") }));
    const { result } = await refused(current);
    expect(result.ok === false && result.error.findings).toEqual(["FACT_VALUE_MISMATCH"]);
    expect(result.ok === false && result.error.problems).toContain("SENTENCE_DATE_NOT_GROUNDED");
  });

  it("refuses an original that is not the file that the fact was made from (SOURCE_CHANGED), and does not judge the value", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current);
    await writeFile(current.rawPath("fictional-shelters/r1/shelters.csv"), encodeUtf8("地区,件数\nあおば,1\n"));
    const { result, lines } = await refused(current);
    expect(result).toEqual({ ok: false, error: { code: "CHECK_FAILED", findings: ["SOURCE_CHANGED"], problems: [] } });
    expect(lines).toContain("recomputed state=UNAVAILABLE reason=ORIGINAL_CHANGED");
  });

  it("refuses an original that is not there", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current);
    await unlink(current.rawPath("fictional-shelters/r1/shelters.csv"));
    const { result, lines } = await refused(current);
    expect(result.ok === false && result.error.findings).toEqual(["SOURCE_CHANGED"]);
    expect(lines).toContain("recomputed state=UNAVAILABLE reason=ORIGINAL_MISSING");
  });

  it("refuses a fact whose source has no record (FACT_SOURCE_MISMATCH, and the original cannot be looked at)", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current);
    await unlink(current.recordPath("sources/fictional-shelters/r1.json"));
    const { result } = await refused(current);
    expect(result.ok === false && result.error.findings).toEqual(["FACT_SOURCE_MISMATCH", "SOURCE_CHANGED"]);
  });

  it("refuses a fact whose license is not the license of its source", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current);
    await edit(current, "fact-rows", (fact) => ({ ...fact, license: { name: "別のライセンス", url: "https://example.org/other" } }));
    const { result } = await refused(current);
    expect(result.ok === false && result.error.findings).toEqual(["FACT_SOURCE_MISMATCH"]);
  });

  it("refuses a fact item of a computation that has no record, and one whose record is not what the computation gives", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current);
    const record = await current.readJson(current.recordPath("aggregations/fact-rows.json"));
    await unlink(current.recordPath("aggregations/fact-rows.json"));
    const missing = await refused(current);
    expect(missing.result.ok === false && missing.result.error.problems).toEqual(["AGGREGATION_RECORD_MISSING"]);
    expect(missing.lines).toContain("record state=MISSING");

    await current.putRecord("aggregations/fact-rows.json", { ...(record as Record<string, unknown>), missingCount: 3 });
    const wrong = await refused(current);
    expect(wrong.result.ok === false && wrong.result.error.problems).toEqual(["AGGREGATION_RECORD_MISMATCH"]);
    expect(wrong.lines).toContain("record missingCount=3 duplicatesRemoved=0");
  });

  it("refuses a computed fact item whose method does not give a value now", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current, { method: SUM_SHELTERS, subject: "避難所の数", unit: "か所" });
    await edit(current, "fact-rows", (fact) => ({ ...fact, method: { ...fact.method, column: "存在しない列" } }));
    const { result, lines } = await refused(current);
    expect(result.ok === false && result.error.findings).toEqual(["FACT_VALUE_MISMATCH"]);
    expect(lines).toContain("recomputed state=REFUSED reason=COLUMN_NOT_FOUND");
  });

  it("does not take a fact item that is not in the store, with a name that is not one, or a person that is not one", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current);
    const deps = session([true, true]).deps;
    expect(await verifyFact(current.store, { factId: "no-such-fact", verifierId: "verifier-1" }, deps)).toEqual({ ok: false, error: { code: "FACT_NOT_FOUND" } });
    expect(await verifyFact(current.store, { factId: "../fact-rows", verifierId: "verifier-1" }, deps)).toEqual({ ok: false, error: { code: "FACT_ID_INVALID" } });
    for (const verifierId of ["", "   ", "v".repeat(65)]) {
      expect(await verifyFact(current.store, { factId: "fact-rows", verifierId }, deps), JSON.stringify(verifierId)).toEqual({ ok: false, error: { code: "VERIFIER_INVALID" } });
    }
    expect(RealFactSchema.parse(JSON.parse(await factText(current, "fact-rows"))).verification.status).toBe("PROVISIONAL");
  });

  it("refuses when the fact items cannot be read", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current);
    await current.putRecordText("facts/broken.json", "{ not json");
    const result = await verifyFact(current.store, { factId: "fact-rows", verifierId: "verifier-1" }, session([true, true]).deps);
    expect(result).toEqual({ ok: false, error: { code: "STORE_READ_FAILED", reason: "RECORD_INVALID" } });
  });
});

describe("verifyFact: a quoted fact item", () => {
  it("is verified on the value at the place that its location names", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const quoted = await createQuotedFact(current.store, {
      factId: "fact-quoted",
      sourceId: "fictional-shelters",
      description: "表の2行目の避難所数の値をそのまま引用した",
      startLine: 2,
      endLine: 2,
      amount: 12,
      unit: "か所",
      surveyDate: "2026-07-27",
      area: "架空県",
      subject: "あおば地区の洪水の避難所の数",
    });
    expect(quoted.ok).toBe(true);
    const talk = session([true, true]);
    const result = await verifyFact(current.store, { factId: "fact-quoted", verifierId: "verifier-1" }, talk.deps);
    expect(result.ok && result.value.status).toBe("VERIFIED");
    expect(talk.lines).toContain("quoted found=true");
    expect(talk.lines[0]).toBe("fact=fact-quoted method=QUOTED status=PROVISIONAL");
    // A quoted fact item has no computation: no blank cells to count, and no record of one.
    expect(talk.lines.some((line) => line.includes("missingCount"))).toBe(false);
    expect(talk.lines.some((line) => line.startsWith("record "))).toBe(false);
  });

  it("is not offered when the value is not at the place that its location names", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await createQuotedFact(current.store, {
      factId: "fact-quoted",
      sourceId: "fictional-shelters",
      description: "引用",
      startLine: 2,
      endLine: 2,
      amount: 12,
      unit: "か所",
      surveyDate: "2026-07-27",
      area: "架空県",
      subject: "避難所の数",
    });
    const fact = RealFactSchema.parse(await current.readJson(current.recordPath("facts/fact-quoted.json")));
    await current.putRecord("facts/fact-quoted.json", { ...fact, locator: { kind: "text-lines", startLine: 3, endLine: 3 } });
    const talk = session([true, true]);
    const result = await verifyFact(current.store, { factId: "fact-quoted", verifierId: "verifier-1" }, talk.deps);
    expect(result).toEqual({ ok: false, error: { code: "CHECK_FAILED", findings: ["FACT_VALUE_MISMATCH"], problems: [] } });
    expect(talk.asked()).toEqual([]);
  });

  it("is not offered when its location is not a place of lines (the code cannot look at it)", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await createQuotedFact(current.store, {
      factId: "fact-quoted",
      sourceId: "fictional-shelters",
      description: "引用",
      startLine: 2,
      endLine: 2,
      amount: 12,
      unit: "か所",
      surveyDate: "2026-07-27",
      area: "架空県",
      subject: "避難所の数",
    });
    const fact = RealFactSchema.parse(await current.readJson(current.recordPath("facts/fact-quoted.json")));
    await current.putRecord("facts/fact-quoted.json", { ...fact, locator: { kind: "pdf-page", page: 3 } });
    const talk = session([true, true]);
    const result = await verifyFact(current.store, { factId: "fact-quoted", verifierId: "verifier-1" }, talk.deps);
    expect(result.ok === false && result.error.findings).toEqual(["FACT_VALUE_MISMATCH"]);
    expect(talk.lines).toContain("recomputed state=REFUSED reason=LOCATOR_UNSUPPORTED");
    expect(talk.lines).toContain("locator kind=pdf-page");
  });
});

describe("verifyFact: a derived fact item", () => {
  async function derivedWorld(): Promise<IntakeWorld> {
    const current = await newWorld();
    await takeInTable(current);
    await createVerifiedFact(current, computedRequest({ factId: "shelters", method: SUM_SHELTERS, subject: "避難所の数", unit: "か所" }));
    await createVerifiedFact(current, computedRequest({ factId: "areas", method: COUNT_ROWS, subject: "記録の数", unit: "か所" }));
    const derived = await createDerivedFact(current.store, {
      factId: "ratio",
      operation: "RATIO",
      operandFactIds: ["shelters", "areas"],
      unitPair: { numerator: "か所", denominator: "か所" },
      subject: "避難所の記録に対する割合",
      description: "避難所の数を記録の数で割った割合",
    });
    if (!derived.ok) {
      throw new Error(`The derived fact item was refused: ${derived.error.code}`);
    }
    return current;
  }

  it("shows the operands, the unit pair and the formula, and is verified on the other two questions", async () => {
    const current = await derivedWorld();
    const talk = session([true, true]);
    const result = await verifyFact(current.store, { factId: "ratio", verifierId: "verifier-2" }, talk.deps);
    expect(result.ok && result.value.status).toBe("VERIFIED");
    expect(talk.asked()).toEqual([...VERIFY_QUESTIONS.derived]);
    expect(talk.lines.slice(0, 7)).toEqual([
      "fact=ratio method=DERIVED operation=RATIO status=PROVISIONAL",
      expect.stringMatching(/^operand1 factId=shelters amount=27 unit=か所 survey=2026-07-27 sha256=[0-9a-f]{64}$/u),
      expect.stringMatching(/^operand2 factId=areas amount=4 unit=か所 survey=2026-07-27 sha256=[0-9a-f]{64}$/u),
      "unitPair numerator=か所 denominator=か所",
      "formula=operand1 / operand2 * 100 decimals=2 rounding=half-away-from-zero",
      "survey=2026-07-27 area=架空県",
      "stored amount=675 unit=%",
    ]);
    expect(talk.lines).toContain("recomputed amount=675 unit=%");
    expect(RealFactSchema.parse(await current.readJson(current.recordPath("facts/ratio.json"))).verification).toMatchObject({ status: "VERIFIED", verifierId: "verifier-2" });
  });

  it("shows the formula of a ratio of two units without the factor of a percent", () => {
    const fact = RealFactSchema.parse({
      dataKind: "REAL_AI",
      factId: "per-site",
      sentence: "架空県の1か所あたりの人口は、2026年7月27日時点で575人/か所です。",
      value: { amount: 575, unit: "人/か所" },
      surveyDate: "2026-07-27",
      area: "架空県",
      publisher: "架空県",
      sourceUrl: "https://example.org/a",
      datasetUrl: "https://example.org/b",
      license: { name: "試験用ライセンス", url: "https://example.org/license" },
      retrievedAt: "2026-11-01T00:00:00Z",
      sha256: "a".repeat(64),
      locator: { kind: "text-lines", startLine: 2, endLine: 5 },
      method: { kind: "DERIVED", operation: "RATIO", operandFactIds: ["people", "sites"], unitPair: { numerator: "人", denominator: "か所" }, description: "d" },
      verification: { status: "PROVISIONAL" },
    });
    const operand = (factId: string, amount: number, unit: string): RealFact => ({ ...fact, factId, value: { amount, unit }, method: { kind: "QUOTED", description: "d" } });
    const lines = verificationLines(
      fact,
      { state: "OK", recomputed: { value: { amount: 575, unit: "人/か所" }, written: { amount: 575, unit: "人/か所" }, surveyDates: ["2026-07-27"], definitionTexts: [] }, detail: { kind: "DERIVED", operands: [operand("people", 2300, "人"), operand("sites", 4, "か所")] } },
      null,
    );
    expect(lines).toContain("formula=operand1 / operand2 decimals=2 rounding=half-away-from-zero");
    expect(lines).toContain("unitPair numerator=人 denominator=か所");
  });

  it("is not offered when the original of an operand changed, and names the operands that count as not verified", async () => {
    const current = await derivedWorld();
    await writeFile(current.rawPath("fictional-shelters/r1/shelters.csv"), encodeUtf8("地区,件数\nあおば,1\n"));
    const talk = session([true, true]);
    const result = await verifyFact(current.store, { factId: "ratio", verifierId: "verifier-2" }, talk.deps);
    expect(result).toEqual({ ok: false, error: { code: "CHECK_FAILED", findings: ["SOURCE_CHANGED"], problems: ["OPERAND_NOT_VERIFIED"] } });
    expect(talk.asked()).toEqual([]);
  });

  it("is not offered when an operand is not verified (any more)", async () => {
    const current = await derivedWorld();
    const operand = RealFactSchema.parse(await current.readJson(current.recordPath("facts/areas.json")));
    await current.putRecord("facts/areas.json", { ...operand, verification: { status: "PROVISIONAL" } });
    const talk = session([true, true]);
    const result = await verifyFact(current.store, { factId: "ratio", verifierId: "verifier-2" }, talk.deps);
    expect(result).toEqual({ ok: false, error: { code: "CHECK_FAILED", findings: [], problems: ["OPERAND_NOT_VERIFIED"] } });
  });

  it("is not offered when an operand is gone, or when the stored value is not the value of the operands", async () => {
    const gone = await derivedWorld();
    await unlink(gone.recordPath("facts/areas.json"));
    const first = await verifyFact(gone.store, { factId: "ratio", verifierId: "verifier-2" }, session([true, true]).deps);
    expect(first.ok === false && first.error.code).toBe("CHECK_FAILED");
    expect(first.ok === false && first.error.problems).toEqual(["OPERAND_MISSING"]);
    await gone.remove();

    const wrong = await derivedWorld();
    const derived = RealFactSchema.parse(await wrong.readJson(wrong.recordPath("facts/ratio.json")));
    await wrong.putRecord("facts/ratio.json", { ...derived, value: { amount: 680, unit: "%" }, sentence: derived.sentence.replace("675", "680") });
    const second = await verifyFact(wrong.store, { factId: "ratio", verifierId: "verifier-2" }, session([true, true]).deps);
    expect(second.ok === false && second.error.findings).toEqual(["FACT_VALUE_MISMATCH"]);
  });

  it("is not offered when the comparison is not allowed any more (the area of an operand is not the area of the fact)", async () => {
    const current = await derivedWorld();
    const operand = RealFactSchema.parse(await current.readJson(current.recordPath("facts/areas.json")));
    await current.putRecord("facts/areas.json", { ...operand, area: "別の県" });
    const result = await verifyFact(current.store, { factId: "ratio", verifierId: "verifier-2" }, session([true, true]).deps);
    expect(result.ok === false && result.error.problems).toContain("COMPARISON_AREA_NOT_STATED");
  });
});

describe("verifyFact: a fact item that is verified already", () => {
  it("asks nothing and writes nothing, and says whether it counts as verified now", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await createVerifiedFact(current, computedRequest());
    const text = await factText(current, "fact-rows");
    const talk = session([true, true]);
    const result = await verifyFact(current.store, { factId: "fact-rows", verifierId: "verifier-9" }, talk.deps);
    expect(result).toMatchObject({ ok: true, value: { status: "ALREADY_VERIFIED", effective: "VERIFIED", findings: [], problems: [] } });
    expect(talk.asked()).toEqual([]);
    expect(await factText(current, "fact-rows")).toBe(text);
    expect(talk.lines[0]).toBe("fact=fact-rows method=COMPUTED aggregation=COUNT_ROWS status=VERIFIED");
  });

  it("says that it does not count as verified when its original changed, and still writes nothing", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await createVerifiedFact(current, computedRequest());
    const text = await factText(current, "fact-rows");
    await writeFile(current.rawPath("fictional-shelters/r1/shelters.csv"), encodeUtf8("地区,件数\nあおば,1\n"));
    const result = await verifyFact(current.store, { factId: "fact-rows", verifierId: "verifier-9" }, session([true, true]).deps);
    expect(result).toMatchObject({ ok: true, value: { status: "ALREADY_VERIFIED", effective: "PROVISIONAL", findings: ["SOURCE_CHANGED"] } });
    expect(await factText(current, "fact-rows")).toBe(text);
  });
});

describe("verifyFact: what is written", () => {
  it("does not write over a fact item that changed while the person was asked, and leaves the file as the other change made it", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current);
    let changed = "";
    const result = await verifyFact(
      current.store,
      { factId: "fact-rows", verifierId: "verifier-1" },
      {
        now: CLOCK,
        write: () => undefined,
        confirm: async () => {
          const fact = RealFactSchema.parse(await current.readJson(current.recordPath("facts/fact-rows.json")));
          await current.putRecord("facts/fact-rows.json", { ...fact, area: "別の地域" });
          changed = await factText(current, "fact-rows");
          return true;
        },
      },
    );
    expect(result).toEqual({ ok: false, error: { code: "FACT_CHANGED" } });
    expect(await factText(current, "fact-rows")).toBe(changed);
  });

  it("leaves the fact item as it was when the file cannot be replaced", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current);
    const text = await factText(current, "fact-rows");
    const store = current.storeWith(failRenameTo((finalPath) => finalPath.endsWith("fact-rows.json")));
    const result = await verifyFact(store, { factId: "fact-rows", verifierId: "verifier-1" }, session([true, true]).deps);
    expect(result).toEqual({ ok: false, error: { code: "STORE_WRITE_FAILED" } });
    expect(await factText(current, "fact-rows")).toBe(text);
    expect((await current.files()).filter((path) => path.endsWith(".tmp"))).toEqual([]);
  });

  it("verifies only the fact item that it is told to verify", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current, { factId: "first" });
    await makeFact(current, { factId: "second", method: COUNT_FLOOD, subject: "洪水の記録の数" });
    const second = await factText(current, "second");
    await verifyFact(current.store, { factId: "first", verifierId: "verifier-1" }, session([true, true]).deps);
    expect(await factText(current, "second")).toBe(second);
  });

  it("makes no network request", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await makeFact(current);
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = ((): never => {
      calls += 1;
      throw new Error("no network for verify-fact");
    }) as unknown as typeof fetch;
    try {
      await verifyFact(current.store, { factId: "fact-rows", verifierId: "verifier-1" }, session([true, true]).deps);
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toBe(0);
  });
});

describe("the only code that makes a fact item VERIFIED is verifyFact", () => {
  it("has no other module of the intake that writes the state VERIFIED", async () => {
    const directory = new URL(".", import.meta.url);
    const names = (await readdir(directory)).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    expect(names).toContain("verifyFact.ts");
    for (const name of names) {
      const text = await readFile(new URL(name, directory), "utf8");
      const writesVerified = /status:\s*["']VERIFIED["']/u.test(text);
      expect(writesVerified, name).toBe(name === "verifyFact.ts");
    }
  });
});
