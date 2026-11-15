import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { FixtureFactSchema, IssuesFileSchema } from "@ehime-vote-navigator/contracts";
import type { FixtureFact } from "@ehime-vote-navigator/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runRegionalValuesCli } from "../../apps/api/src/regional-values/cli.js";
import { factNumeralsOf, runDraftChecks } from "../../apps/api/src/regional-values/draft/checks.js";
import { defaultRecordRoot } from "../../apps/api/src/regional-values/draft/types.js";
import type { RecordRoot } from "../../apps/api/src/regional-values/draft/types.js";
import { createFileIssueInputs } from "../../apps/api/src/regional-values/issues/inputs.js";
import { loadIssueSnapshot } from "../../apps/api/src/regional-values/issues/loadIssueSnapshot.js";
import { generateFixtureIssueRecords, ISSUE_SPECS, loadTestIssueSettings } from "../harness/regional-values/fixtureIssueRecords.js";

// The fictional issues (tasks 16.7 and 16.14). The sample `issues.json` is not written by hand: it is the
// output of `issues export --data-mode FIXTURE --generated-at 2026-01-04T09:00:00Z` on the input records
// in Git, and the tests make it again and compare. The lists of words are the test-only ones.

const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURE_DIRECTORY = join(REPOSITORY, "packages", "fixtures", "src", "regional-values");
const TEST_CONFIG = join(REPOSITORY, "tests", "harness", "regional-values", "test-config");
const SAMPLE_PATH = join(FIXTURE_DIRECTORY, "issues.json");
const GENERATED_AT = "2026-01-04T09:00:00Z";
const REAL_NAMES = ["愛媛県", "松山市", "今治市", "新居浜市", "自由民主党", "立憲民主党"] as const;

/** The text of a file with LF, so that a checkout that changes line endings does not change a comparison. */
async function textOf(path: string): Promise<string> {
  return (await readFile(path, "utf8")).replaceAll("\r\n", "\n");
}

async function filesBelow(directory: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await filesBelow(join(directory, entry.name), `${path}/`)));
    } else {
      found.push(path);
    }
  }
  return found.sort();
}

describe("the input records of the fictional issues are made again by the functions of the draft process (16.14)", () => {
  let temporary: string;
  beforeEach(async () => {
    temporary = await mkdtemp(join(tmpdir(), "rv-fixture-issues-"));
  });
  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  it("gives the files that are in Git, byte for byte, and no other file in those places", async () => {
    const root: RecordRoot = { ...defaultRecordRoot(temporary, "FIXTURE"), rootDir: temporary };
    await generateFixtureIssueRecords(root);
    const generated = await filesBelow(temporary);
    expect(generated.length).toBeGreaterThan(10);
    for (const place of ["drafts", "events", "issues", "approvals"]) {
      const inGit = (await filesBelow(join(FIXTURE_DIRECTORY, place))).map((name) => `${place}/${name}`);
      expect(inGit, place).toEqual(generated.filter((name) => name.startsWith(`${place}/`)));
    }
    for (const name of generated) {
      expect(await textOf(join(FIXTURE_DIRECTORY, name)), name).toBe(await textOf(join(temporary, name)));
    }
  });

  it("is the same when it is made twice", async () => {
    const first = await mkdtemp(join(tmpdir(), "rv-fixture-issues-a-"));
    try {
      await generateFixtureIssueRecords({ ...defaultRecordRoot(first, "FIXTURE"), rootDir: first });
      await generateFixtureIssueRecords({ ...defaultRecordRoot(temporary, "FIXTURE"), rootDir: temporary });
      const names = await filesBelow(first);
      expect(names).toEqual(await filesBelow(temporary));
      for (const name of names) {
        expect(await textOf(join(first, name)), name).toBe(await textOf(join(temporary, name)));
      }
    } finally {
      await rm(first, { recursive: true, force: true });
    }
  });
});

describe("the sample issues.json of fictional data (16.7)", () => {
  let workspace: string;
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "rv-sample-"));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  async function run(args: readonly string[]): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    const code = await runRegionalValuesCli(["issues", ...args], {
      workspaceRoot: workspace,
      io: { write: (line) => lines.push(line) },
      issues: { recordRoot: (kind) => defaultRecordRoot(REPOSITORY, kind) },
    });
    return { code, lines };
  }

  const exportArguments = [
    "export",
    "--data-mode",
    "FIXTURE",
    "--generated-at",
    GENERATED_AT,
    "--config-dir",
    TEST_CONFIG,
    "--draft-settings",
    join(TEST_CONFIG, "draft-settings.json"),
  ];

  it("is the output of issues export on the input records, to the last byte", async () => {
    expect(await run(exportArguments)).toEqual({ code: 0, lines: ["code=EXPORT_OK issues=3 withdrawn=0"] });
    const output = await textOf(join(workspace, "dist", "regional-values", "issues", "fixture", "issues.json"));
    expect(await textOf(SAMPLE_PATH)).toBe(output);
  });

  it("passes the contract and the verification, and is a file of fictional data: nothing is withdrawn, one issue for each of the three themes", async () => {
    const file = IssuesFileSchema.parse(JSON.parse(await readFile(SAMPLE_PATH, "utf8")));
    expect(file.meta).toMatchObject({ schemaVersion: 1, kind: "ISSUES", dataKind: "FIXTURE", generatedAt: GENERATED_AT });
    expect(file.withdrawn).toEqual([]);
    expect(file.issues.map((issue) => issue.issueId)).toEqual(["fixture-issue-disaster-v1", "fixture-issue-education-v1", "fixture-issue-population-v1"]);
    const counts = Object.fromEntries(file.coverage.map((entry) => [entry.themeId, entry.issueCount]));
    expect(counts).toMatchObject({ POPULATION_REVITALIZATION: 1, DISASTER_PREVENTION: 1, EDUCATION_CHILDCARE: 1, TRANSPORT: 0 });

    const verified = await run(["verify", "--file", SAMPLE_PATH]);
    expect(verified.code).toBe(0);
    expect(verified.lines.at(-1)).toBe("code=VERIFY_OK dataKind=FIXTURE");
    expect(verified.lines[0]).toMatch(/^fileSha256=[0-9a-f]{64}$/u);
  });

  it("is the same as the issues that the records give now, and the checks of a draft find nothing in them", async () => {
    const settings = await loadTestIssueSettings();
    const loaded = await loadIssueSnapshot(createFileIssueInputs(defaultRecordRoot(REPOSITORY, "FIXTURE")), settings);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const file = IssuesFileSchema.parse(JSON.parse(await readFile(SAMPLE_PATH, "utf8")));
    expect(JSON.parse(JSON.stringify(loaded.value.issues))).toEqual(JSON.parse(JSON.stringify(file.issues)));
    expect(file.meta.inputDigest).toBe(loaded.value.inputDigest);
    for (const issue of file.issues) {
      const checked = runDraftChecks(
        JSON.stringify({
          themeId: issue.themeId,
          title: issue.title,
          statement: issue.statement,
          basisFactIds: issue.basisFacts.map((fact) => fact.factId),
          factSummary: issue.factSummary,
          background: issue.background,
          notDeterminable: issue.notDeterminable,
          additionalChecks: issue.additionalChecks,
          decisionScenes: issue.decisionScenes,
          responseDirections: issue.responseDirections,
        }),
        {
          task: "ISSUE_CANDIDATE",
          dataKind: "FIXTURE",
          config: settings.checks,
          evidence: [],
          facts: issue.basisFacts,
          themes: settings.themes,
          factNumerals: factNumeralsOf(issue.basisFacts),
          today: "2026-01-04",
        },
      );
      expect(checked.ok, issue.issueId).toBe(true);
    }
  });

  it("is an issue that is a hypothesis: every direction is for reference only, and no sentence names a real municipality or party", async () => {
    const text = await readFile(SAMPLE_PATH, "utf8");
    const file = IssuesFileSchema.parse(JSON.parse(text));
    for (const issue of file.issues) {
      expect(issue.statement).toMatch(/^架空/u);
      expect(issue.responseDirections.length).toBeGreaterThan(0);
      for (const direction of issue.responseDirections) {
        expect(direction.status).toBe("REFERENCE_ONLY");
      }
    }
    for (const name of REAL_NAMES) {
      expect(text).not.toContain(name);
    }
  });

  it("is the output of the export after a build of the same input: the state of the output says OK and current", async () => {
    await run(exportArguments);
    const verified = await run([
      "verify",
      "--output",
      "--data-mode",
      "FIXTURE",
      "--current",
      "--config-dir",
      TEST_CONFIG,
      "--draft-settings",
      join(TEST_CONFIG, "draft-settings.json"),
    ]);
    expect(verified).toEqual({ code: 0, lines: ["code=VERIFY_OK current=true"] });
  });
});

describe("what the checks of a draft refuse (kept in the test, never in the file)", () => {
  const registry = async (): Promise<FixtureFact[]> => FixtureFactSchema.array().parse(JSON.parse(await readFile(join(FIXTURE_DIRECTORY, "facts.json"), "utf8")) as unknown);
  const population = ISSUE_SPECS[0]?.candidate ?? {};

  async function violationsOf(candidate: Record<string, unknown>, factIds?: readonly string[]): Promise<string[]> {
    const settings = await loadTestIssueSettings();
    const facts = (await registry()).filter((fact) => (factIds ?? (candidate.basisFactIds as string[])).includes(fact.factId));
    const result = runDraftChecks(JSON.stringify(candidate), {
      task: "ISSUE_CANDIDATE",
      dataKind: "FIXTURE",
      config: settings.checks,
      evidence: [],
      facts,
      themes: settings.themes,
      factNumerals: factNumeralsOf(facts),
      today: "2026-01-04",
    });
    return result.ok ? [] : result.violations.map((violation) => violation.check);
  }

  it("passes the candidate that the sample is made of", async () => {
    expect(await violationsOf(population)).toEqual([]);
  });

  it("refuses a statement that states a cause (DR_CAUSAL_CLAIMS)", async () => {
    const candidate = { ...population, statement: "架空市あおばでは、参加者の減少が原因で集まりが減る可能性があります。" };
    expect(await violationsOf(candidate)).toContain("DR_CAUSAL_CLAIMS");
  });

  it("refuses a number that is not in the facts, and a computed value (DR_CANDIDATE_FACTS)", async () => {
    const wrong = { ...population, factSummary: [{ text: "架空市あおばの地域の集まりの参加者は、2023年度が延べ500人です。", groundFactIds: ["fixture-fact-population-2023-v1"] }] };
    expect(await violationsOf(wrong)).toContain("DR_CANDIDATE_FACTS");
    const computed = { ...population, factSummary: [{ text: "架空市あおばの地域の集まりの参加者は、60人減りました。", groundFactIds: ["fixture-fact-population-2024-v1"] }] };
    expect(await violationsOf(computed)).toContain("DR_CANDIDATE_FACTS");
  });

  it("refuses a basis fact that does not exist (DR_CANDIDATE_FACTS)", async () => {
    const candidate = { ...population, basisFactIds: ["fixture-fact-population-2023-v1", "fixture-fact-missing-v1"] };
    expect(await violationsOf(candidate, ["fixture-fact-population-2023-v1"])).toContain("DR_CANDIDATE_FACTS");
  });

  it("refuses a statement that is not a hypothesis (DR_HEDGE_REQUIRED)", async () => {
    expect(await violationsOf({ ...population, statement: "架空市あおばでは、地域の集まりへの参加が減っています。" })).toContain("DR_HEDGE_REQUIRED");
  });

  it("refuses a comparison of two years that does not say the years, and a comparison of two areas (DR_COMPARISON)", async () => {
    const years = {
      ...population,
      factSummary: [{ text: "架空市あおばの参加者は、前の年度と比べて少ないです。", groundFactIds: ["fixture-fact-population-2023-v1", "fixture-fact-population-2024-v1"] }],
    };
    expect(await violationsOf(years)).toContain("DR_COMPARISON");
    const areas = {
      ...population,
      basisFactIds: ["fixture-fact-population-2024-v1", "fixture-fact-disaster-v1"],
      background: [],
      factSummary: [{ text: "架空市あおばは、架空町みなとと比べて少ないです。", groundFactIds: ["fixture-fact-population-2024-v1", "fixture-fact-disaster-v1"] }],
    };
    expect(await violationsOf(areas)).toContain("DR_COMPARISON");
  });

  it("refuses a direction with a negation, and a direction with a recommendation (DR_DIRECTION_RULES)", async () => {
    const direction = (over: Record<string, unknown>) => ({ label: "新しい集まりの場をつくる", description: "新しい場を用意する取り組みです。", category: "CHANGE", status: "REFERENCE_ONLY", ...over });
    const negation = { ...population, responseDirections: [direction({ description: "今ある集まりより、新しい場を用意する取り組みです。" })] };
    expect(await violationsOf(negation)).toContain("DR_DIRECTION_RULES");
    const recommendation = { ...population, responseDirections: [direction({ label: "推奨語の集まり" })] };
    expect(await violationsOf(recommendation)).toEqual(expect.arrayContaining(["DR_DIRECTION_RULES"]));
  });

  it("refuses a candidate that states nothing that cannot be told, or nothing to check (DR_UNKNOWN_REQUIRED)", async () => {
    expect(await violationsOf({ ...population, notDeterminable: [] })).toContain("DR_UNKNOWN_REQUIRED");
    expect(await violationsOf({ ...population, additionalChecks: [] })).toContain("DR_UNKNOWN_REQUIRED");
  });
});
