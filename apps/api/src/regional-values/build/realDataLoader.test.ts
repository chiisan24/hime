import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { GATE_REASON_CODES } from "@ehime-vote-navigator/contracts";
import type { GateFinding } from "@ehime-vote-navigator/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createBuildWorkspace } from "../../../../../tests/harness/regional-values/buildWorkspace.js";
import type { BuildWorkspace } from "../../../../../tests/harness/regional-values/buildWorkspace.js";
import { COUNT_ROWS, SUM_SHELTERS, computedRequest, createVerifiedFact, takeInTable } from "../../../../../tests/harness/regional-values/factSupport.js";
import { createIntakeWorld } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import type { IntakeWorld } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import { encodeUtf8 } from "../../../../../tests/harness/regional-values/shiftJis.js";
import { createSafeLogger } from "../../logging/safeLogger.js";
import { createComputedFact, createDerivedFact } from "../intake/factValue.js";
import { recordSourceReview } from "../intake/sourceReview.js";
import { createRealDataLoader } from "./realData.js";
import { runBuild } from "./runBuild.js";
import type { BuildRequest, RealDataOutcome } from "./runBuild.js";

// What the build says about the real data that the intake and the creation of fact items wrote. Every file, name and number is fictional, and
// the files are made in a temporary workspace. No finding carries a value of a file: a code, a class and the ID of what it is about.

let workspace: BuildWorkspace | undefined;
let world: IntakeWorld | undefined;

afterEach(async () => {
  await world?.remove();
  await workspace?.remove();
  workspace = undefined;
  world = undefined;
});

async function prepare(): Promise<IntakeWorld> {
  workspace = await createBuildWorkspace();
  world = await createIntakeWorld({ base: workspace.root });
  return world;
}

const REVIEWED = {
  usage: { status: "CONFIRMED", checkedAt: "2026-11-05", checkedTarget: "利用条件のページ", evidence: "利用可と書かれている" },
  datasetNote: { hasSpecificNote: false, checkedBy: "analyst-1", checkedAt: "2026-11-05T01:00:00Z" },
} as const;

/** What a person has confirmed about a source: its terms of use, and the check of the note of its data set. */
async function review(current: IntakeWorld, revision = "r1"): Promise<void> {
  const result = await recordSourceReview(current.store, { sourceId: "fictional-shelters", revision }, REVIEWED);
  expect(result.ok, JSON.stringify(result)).toBe(true);
}

async function load(current: IntakeWorld, lists = {}): Promise<RealDataOutcome> {
  return createRealDataLoader(lists)(current.store.root.rootDir);
}

async function findingsOf(current: IntakeWorld): Promise<readonly GateFinding[]> {
  const outcome = await load(current);
  if (outcome.kind !== "FINDINGS") {
    throw new Error("The real data was not read");
  }
  return outcome.findings;
}

const codesOf = (findings: readonly GateFinding[]): string[] => findings.map((finding) => `${finding.code}:${finding.targetKind}:${finding.targetId ?? "-"}`);

describe("createRealDataLoader: what there is to read", () => {
  it("says that the real data is absent when there is no directory, or nothing in it", async () => {
    const current = await prepare();
    expect(await load(current)).toEqual({ kind: "FINDINGS", findings: [{ code: "REAL_DATA_ABSENT", class: "SHORTAGE", targetKind: "BUNDLE", targetId: null }] });
    await mkdir(current.store.root.rootDir, { recursive: true });
    expect(await load(current)).toEqual({ kind: "FINDINGS", findings: [{ code: "REAL_DATA_ABSENT", class: "SHORTAGE", targetKind: "BUNDLE", targetId: null }] });
  });

  it.each(["cards.json", "question-bank.json", "result-texts.json", "fixed-texts.json", "release.json", "placeholder.json", "notes"])(
    "does not read, and says so, when the directory holds %s, which this loader does not know (the build fails, and does not build the fictional data instead)",
    async (name) => {
      const current = await prepare();
      await takeInTable(current);
      await writeFile(join(current.store.root.rootDir, name), "{}");
      expect(await load(current)).toEqual({ kind: "NOT_IMPLEMENTED" });
    },
  );

  it("reads the records of the intake, the drafts and the approvals, and says that there is no card yet", async () => {
    const current = await prepare();
    await takeInTable(current);
    const findings = await findingsOf(current);
    expect(findings.map((finding) => finding.code)).toContain("REAL_DATA_ABSENT");
    expect(findings.every((finding) => finding.class === "SHORTAGE")).toBe(true);
  });
});

describe("createRealDataLoader: the sources (G2, G3)", () => {
  it("asks for the terms of use and for the check of the note of the data set, for a source that was just taken in", async () => {
    const current = await prepare();
    await takeInTable(current);
    expect(codesOf(await findingsOf(current))).toEqual([
      "REAL_DATA_ABSENT:BUNDLE:-",
      "USAGE_NOT_CONFIRMED:SOURCE:fictional-shelters/r1",
      "NOTE_REVIEW_MISSING:SOURCE:fictional-shelters/r1",
    ]);
  });

  it("asks for nothing more of a source that a person has confirmed, and for its terms of use only when they are not confirmed (RESTRICTED is not confirmed)", async () => {
    const current = await prepare();
    await takeInTable(current);
    await review(current);
    expect(codesOf(await findingsOf(current))).toEqual(["REAL_DATA_ABSENT:BUNDLE:-"]);
    await recordSourceReview(current.store, { sourceId: "fictional-shelters", revision: "r1" }, { usage: { ...REVIEWED.usage, status: "RESTRICTED" } });
    expect(codesOf(await findingsOf(current))).toEqual(["REAL_DATA_ABSENT:BUNDLE:-", "USAGE_NOT_CONFIRMED:SOURCE:fictional-shelters/r1"]);
  });

  it("judges the latest revision of a source, and a source that a fact item rests on, and not the history", async () => {
    const current = await prepare();
    await takeInTable(current);
    await takeInTable(current, "地区,避難所数\nあおば,1\n");
    await review(current, "r2");
    // r1 is history: nobody rests on it, and the latest revision (r2) is confirmed.
    expect(codesOf(await findingsOf(current))).toEqual(["REAL_DATA_ABSENT:BUNDLE:-"]);
  });

  it("judges an old revision when a fact item rests on it", async () => {
    const current = await prepare();
    await takeInTable(current);
    await createComputedFact(current.store, computedRequest());
    await takeInTable(current, "地区,避難所数\nあおば,1\n");
    await review(current, "r2");
    const codes = codesOf(await findingsOf(current));
    expect(codes).toContain("USAGE_NOT_CONFIRMED:SOURCE:fictional-shelters/r1");
    expect(codes).not.toContain("USAGE_NOT_CONFIRMED:SOURCE:fictional-shelters/r2");
  });

  it("asks for the information that the license notice needs: a source that has no URL is not enough", async () => {
    const current = await prepare();
    await takeInTable(current, undefined, { reference: { kind: "document-id", documentId: "doc-0001" } });
    await review(current);
    expect(codesOf(await findingsOf(current))).toEqual(["REAL_DATA_ABSENT:BUNDLE:-", "LICENSE_INFO_MISSING:SOURCE:fictional-shelters/r1"]);
  });
});

describe("createRealDataLoader: the fact items (G4)", () => {
  async function confirmedWorld(): Promise<IntakeWorld> {
    const current = await prepare();
    await takeInTable(current);
    await review(current);
    return current;
  }

  it("asks for the verification of a fact item that a person has not verified, and for nothing when it is verified", async () => {
    const current = await confirmedWorld();
    await createComputedFact(current.store, computedRequest());
    expect(codesOf(await findingsOf(current))).toEqual(["REAL_DATA_ABSENT:BUNDLE:-", "FACT_NOT_VERIFIED:FACT_ITEM:fact-rows"]);
    await unlink(current.recordPath("facts/fact-rows.json"));
    await unlink(current.recordPath("aggregations/fact-rows.json"));
    await createVerifiedFact(current, computedRequest());
    expect(codesOf(await findingsOf(current))).toEqual(["REAL_DATA_ABSENT:BUNDLE:-"]);
  });

  it("says SOURCE_CHANGED, a shortage, for a verified fact item whose original is not the file that it was made from", async () => {
    const current = await confirmedWorld();
    await createVerifiedFact(current, computedRequest());
    await current.putRaw("fictional-shelters/r1/shelters.csv", encodeUtf8("地区,種別,避難所数,人口\nあおば,洪水,99,1200人\n"));
    const findings = await findingsOf(current);
    expect(codesOf(findings)).toEqual(["REAL_DATA_ABSENT:BUNDLE:-", "SOURCE_CHANGED:FACT_ITEM:fact-rows"]);
    expect(findings.every((finding) => finding.class === "SHORTAGE")).toBe(true);
  });

  it("says SOURCE_FILE_MISSING too when there is no original", async () => {
    const current = await confirmedWorld();
    await createVerifiedFact(current, computedRequest());
    await unlink(current.rawPath("fictional-shelters/r1/shelters.csv"));
    expect(codesOf(await findingsOf(current))).toEqual(["REAL_DATA_ABSENT:BUNDLE:-", "SOURCE_CHANGED:FACT_ITEM:fact-rows", "SOURCE_FILE_MISSING:FACT_ITEM:fact-rows"]);
  });

  it("says FACT_VALUE_MISMATCH, a defect, for a stored value that is not what the original gives", async () => {
    const current = await confirmedWorld();
    await createVerifiedFact(current, computedRequest());
    const fact = (await current.readJson(current.recordPath("facts/fact-rows.json"))) as { value: { amount: number; unit: string } };
    await current.putRecord("facts/fact-rows.json", { ...fact, value: { ...fact.value, amount: fact.value.amount + 1 } });
    const findings = await findingsOf(current);
    expect(codesOf(findings)).toEqual(["REAL_DATA_ABSENT:BUNDLE:-", "FACT_VALUE_MISMATCH:FACT_ITEM:fact-rows"]);
    expect(findings.find((finding) => finding.code === "FACT_VALUE_MISMATCH")?.class).toBe("DEFECT");
  });

  it("says FACT_SOURCE_MISMATCH, a defect, for a fact item whose license is not the license of its source", async () => {
    const current = await confirmedWorld();
    await createVerifiedFact(current, computedRequest());
    const fact = (await current.readJson(current.recordPath("facts/fact-rows.json"))) as { license: { name: string; url: string } };
    await current.putRecord("facts/fact-rows.json", { ...fact, license: { name: "別のライセンス", url: "https://example.org/other" } });
    const findings = await findingsOf(current);
    expect(codesOf(findings)).toEqual(["REAL_DATA_ABSENT:BUNDLE:-", "FACT_SOURCE_MISMATCH:FACT_ITEM:fact-rows"]);
    expect(findings.find((finding) => finding.code === "FACT_SOURCE_MISMATCH")?.class).toBe("DEFECT");
  });

  it("asks for the verification of an operand of a derived fact item that is not verified now", async () => {
    const current = await confirmedWorld();
    await createVerifiedFact(current, computedRequest({ factId: "shelters", method: SUM_SHELTERS, subject: "避難所の数", unit: "か所" }));
    await createVerifiedFact(current, computedRequest({ factId: "areas", method: COUNT_ROWS, subject: "記録の数", unit: "か所" }));
    const derived = await createDerivedFact(current.store, { factId: "ratio", operation: "RATIO", operandFactIds: ["shelters", "areas"], unitPair: { numerator: "か所", denominator: "か所" }, subject: "割合", description: "d" });
    expect(derived.ok).toBe(true);
    const operand = (await current.readJson(current.recordPath("facts/areas.json"))) as Record<string, unknown>;
    await current.putRecord("facts/areas.json", { ...operand, verification: { status: "PROVISIONAL" } });
    const codes = codesOf(await findingsOf(current));
    expect(codes).toContain("FACT_NOT_VERIFIED:FACT_ITEM:areas");
    expect(codes).toContain("FACT_NOT_VERIFIED:FACT_ITEM:ratio");
  });

  it("is a function of what is on the disk: the same list, in the order of the codes of the contract, with no duplicate", async () => {
    const current = await prepare();
    await takeInTable(current);
    await createComputedFact(current.store, computedRequest({ factId: "fact-b" }));
    await createComputedFact(current.store, computedRequest({ factId: "fact-a", subject: "別の記録の数" }));
    const first = await findingsOf(current);
    expect(await findingsOf(current)).toEqual(first);
    const indexes = first.map((finding) => GATE_REASON_CODES.indexOf(finding.code));
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
    expect(new Set(codesOf(first)).size).toBe(first.length);
  });

  it("says CONTRACT_VIOLATION, a defect, for a record that is not a record of its contract, and writes nothing", async () => {
    const current = await confirmedWorld();
    await createComputedFact(current.store, computedRequest());
    const before = await current.files();
    await current.putRecordText("facts/broken.json", "{ not json");
    const findings = await findingsOf(current);
    expect(codesOf(findings)).toEqual(["REAL_DATA_ABSENT:BUNDLE:-", "CONTRACT_VIOLATION:BUNDLE:-"]);
    expect(findings.find((finding) => finding.code === "CONTRACT_VIOLATION")?.class).toBe("DEFECT");
    await unlink(current.recordPath("facts/broken.json"));
    expect(await current.files()).toEqual(before);
  });

  it("carries no value of a file, no path and no text of a record: a code, a class, a kind of target and an ID", async () => {
    const current = await confirmedWorld();
    await createVerifiedFact(current, computedRequest());
    await current.putRaw("fictional-shelters/r1/shelters.csv", encodeUtf8("地区,種別,避難所数,人口\nあおば,洪水,99,1200人\n"));
    const text = JSON.stringify(await findingsOf(current));
    expect(text).not.toContain("あおば");
    expect(text).not.toContain("避難所の記録の数");
    expect(text).not.toContain(workspace?.root ?? "never");
  });
});

describe("the build with the real data that the intake wrote", () => {
  const GENERATED_AT = "2026-01-04T09:00:00Z";

  function requestOf(base: BuildWorkspace, change: Partial<BuildRequest> = {}): BuildRequest {
    return { workspaceRoot: base.root, configDir: base.configDir, buildKind: "DEMO", dataMode: "REAL_PREFERRED", generatedAt: GENERATED_AT, ...change };
  }

  const dependencies = () => ({ now: () => "2026-08-10T10:00:00+09:00", logger: createSafeLogger(() => undefined) });

  async function exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  it("builds the fictional data for REAL_PREFERRED, and says why: the real data of a person who has begun is not a reason to fail", async () => {
    const current = await prepare();
    await takeInTable(current);
    await createComputedFact(current.store, computedRequest());
    const result = await runBuild(requestOf(workspace as BuildWorkspace), dependencies());
    expect(result.exitCode).toBe(0);
    expect(result.report.switched).toBe(true);
    expect(result.report.switchReasonCodes).toEqual(["REAL_DATA_ABSENT", "USAGE_NOT_CONFIRMED", "NOTE_REVIEW_MISSING", "FACT_NOT_VERIFIED"]);
    expect(await exists(join((workspace as BuildWorkspace).outputDirectory("demo"), "bundle.json"))).toBe(true);
  });

  it("fails REAL with every shortage, and builds nothing", async () => {
    const current = await prepare();
    await takeInTable(current);
    const result = await runBuild(requestOf(workspace as BuildWorkspace, { dataMode: "REAL" }), dependencies());
    expect(result.exitCode).toBe(1);
    expect(result.report.findings.map((finding) => finding.code)).toEqual(["REAL_DATA_ABSENT", "USAGE_NOT_CONFIRMED", "NOTE_REVIEW_MISSING"]);
    expect(await exists(join((workspace as BuildWorkspace).outputDirectory("demo"), "bundle.json"))).toBe(false);
  });

  it("does not hide a defect of the real data behind the fictional data: REAL_PREFERRED fails", async () => {
    const current = await prepare();
    await takeInTable(current);
    await review(current);
    await createVerifiedFact(current, computedRequest());
    const fact = (await current.readJson(current.recordPath("facts/fact-rows.json"))) as { value: { amount: number; unit: string } };
    await current.putRecord("facts/fact-rows.json", { ...fact, value: { ...fact.value, amount: 99 } });
    const result = await runBuild(requestOf(workspace as BuildWorkspace), dependencies());
    expect(result.exitCode).toBe(1);
    expect(result.report.switched).toBe(false);
    expect(result.report.findings.map((finding) => finding.code)).toContain("FACT_VALUE_MISMATCH");
    expect(await exists(join((workspace as BuildWorkspace).outputDirectory("demo"), "bundle.json"))).toBe(false);
  });

  it("does not read the real data for FIXTURE", async () => {
    const current = await prepare();
    await takeInTable(current);
    await current.putRecordText("facts/broken.json", "{ not json");
    const result = await runBuild(requestOf(workspace as BuildWorkspace, { dataMode: "FIXTURE" }), dependencies());
    expect(result.exitCode).toBe(0);
    expect(result.report.switched).toBe(false);
  });
});
