import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { BuildReportSchema, QuestionBankSchema } from "@ehime-vote-navigator/contracts";
import type { BuildReport } from "@ehime-vote-navigator/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createBuildWorkspace } from "../../../../../tests/harness/regional-values/buildWorkspace.js";
import type { BuildWorkspace } from "../../../../../tests/harness/regional-values/buildWorkspace.js";
import { loadTestIssueSettings } from "../../../../../tests/harness/regional-values/fixtureIssueRecords.js";
import { createSafeLogger } from "../../logging/safeLogger.js";
import { createDraftStore } from "../draft/draftStore.js";
import { revokeApproval } from "../draft/review.js";
import { defaultRecordRoot } from "../draft/types.js";
import { createIssueSource } from "../issuesCli.js";
import { runBuild } from "./runBuild.js";
import type { BuildRequest, IssueSource } from "./runBuild.js";

// The build and the record of links (16.9). The workspace is a temporary copy of the fictional data of the
// repository (with its issues), and the settings of the checks are the test-only ones.

const GENERATED_AT = "2026-01-04T09:00:00Z";
const POPULATION_ISSUE = "fixture-issue-population-v1";

let workspace: BuildWorkspace | undefined;

afterEach(async () => {
  await workspace?.remove();
  workspace = undefined;
});

const clock = (): (() => string) => () => "2026-08-10T10:00:00+09:00";

function request(base: BuildWorkspace): BuildRequest {
  return { workspaceRoot: base.root, configDir: base.configDir, buildKind: "DEMO", dataMode: "FIXTURE", generatedAt: GENERATED_AT };
}

async function build(base: BuildWorkspace, issueSource?: IssueSource): Promise<{ exitCode: number; report: BuildReport }> {
  const result = await runBuild(request(base), {
    now: clock(),
    logger: createSafeLogger(() => undefined),
    ...(issueSource === undefined ? {} : { issueSource }),
  });
  return { exitCode: result.exitCode, report: BuildReportSchema.parse(result.report) };
}

async function realSource(base: BuildWorkspace): Promise<IssueSource> {
  return createIssueSource({ workspaceRoot: base.root }, await loadTestIssueSettings());
}

const fixtureDirectory = (base: BuildWorkspace): string => join(base.root, "packages", "fixtures", "src", "regional-values");
const bundlePath = (base: BuildWorkspace): string => join(base.outputDirectory("demo"), "bundle.json");

async function bundleText(base: BuildWorkspace): Promise<string> {
  return readFile(bundlePath(base), "utf8");
}

async function writeLinks(base: BuildWorkspace, links: readonly Record<string, unknown>[]): Promise<void> {
  await writeFile(join(fixtureDirectory(base), "issue-links.json"), JSON.stringify({ schemaVersion: 1, dataKind: "FIXTURE", links }));
}

async function ids(base: BuildWorkspace): Promise<{ questionId: string; cardId: string }> {
  const bank = QuestionBankSchema.parse(JSON.parse(await readFile(join(fixtureDirectory(base), "question-bank.json"), "utf8")) as unknown);
  const cards = JSON.parse(await readFile(join(fixtureDirectory(base), "cards.json"), "utf8")) as { cardId: string }[];
  return { questionId: bank.questions[0]?.questionId ?? "", cardId: cards[0]?.cardId ?? "" };
}

async function revokePopulationIssue(base: BuildWorkspace): Promise<void> {
  const store = createDraftStore(defaultRecordRoot(base.root, "FIXTURE"));
  const revoked = await revokeApproval(
    { store, now: () => new Date("2026-01-05T00:00:00Z") },
    { targetKind: "ISSUE", targetId: POPULATION_ISSUE, version: 1, revokerId: "fixture-issue-approver-v1" },
  );
  expect(revoked.ok).toBe(true);
}

const codesOf = (report: BuildReport): string[] => report.findings.map((finding) => finding.code);

describe("runBuild with the issues (16.9)", () => {
  it("builds the same bundle with the issues of the repository as without them: the issues do not reach the bundle", async () => {
    workspace = await createBuildWorkspace({}, { issueRecords: true });
    expect((await build(workspace)).exitCode).toBe(0);
    const without = await bundleText(workspace);
    const withIssues = await build(workspace, await realSource(workspace));
    expect(withIssues.exitCode).toBe(0);
    expect(await bundleText(workspace)).toBe(without);
  });

  it("builds the same bundle with links that name valid issues, and the links are not in the bundle", async () => {
    workspace = await createBuildWorkspace({}, { issueRecords: true });
    const source = await realSource(workspace);
    expect((await build(workspace, source)).exitCode).toBe(0);
    const before = await bundleText(workspace);
    const { questionId, cardId } = await ids(workspace);
    await writeLinks(workspace, [
      { targetKind: "QUESTION", targetId: questionId, issueId: POPULATION_ISSUE, issueVersion: 1 },
      { targetKind: "ISSUE_CARD", targetId: cardId, issueId: POPULATION_ISSUE, issueVersion: 1 },
    ]);
    expect((await build(workspace, source)).exitCode).toBe(0);
    const after = await bundleText(workspace);
    expect(after).toBe(before);
    expect(after).not.toContain(POPULATION_ISSUE);
    expect(after).not.toContain("issueVersion");
    // The statement of an issue (a hypothesis), the numbers that only the issues have and the direction candidates are not in the public bundle.
    for (const text of ["地域の集まりへの参加が減っている可能性があります", "延べ480人", "新しい集まりの場をつくる", "REFERENCE_ONLY", "fixture-issue-"]) {
      expect(after, text).not.toContain(text);
    }
  });

  it("builds when the file of the record of links is not there", async () => {
    workspace = await createBuildWorkspace({}, { issueRecords: true });
    await rm(join(fixtureDirectory(workspace), "issue-links.json"));
    expect((await build(workspace, await realSource(workspace))).exitCode).toBe(0);
  });

  it("fails with CONTRACT_VIOLATION, a defect, for a link to an issue that does not exist, and writes no bundle", async () => {
    workspace = await createBuildWorkspace({}, { issueRecords: true });
    const { questionId } = await ids(workspace);
    await writeLinks(workspace, [{ targetKind: "QUESTION", targetId: questionId, issueId: "fixture-issue-none-v1", issueVersion: 1 }]);
    const result = await build(workspace, await realSource(workspace));
    expect(result.exitCode).toBe(1);
    expect(result.report.findings).toEqual([{ code: "CONTRACT_VIOLATION", class: "DEFECT", targetKind: "QUESTION", targetId: questionId }]);
    await expect(readFile(bundlePath(workspace), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails with CONTRACT_VIOLATION for a link to a question that does not exist, and for a record that is not a record of links", async () => {
    workspace = await createBuildWorkspace({}, { issueRecords: true });
    await writeLinks(workspace, [{ targetKind: "QUESTION", targetId: "q-none", issueId: POPULATION_ISSUE, issueVersion: 1 }]);
    const missing = await build(workspace, await realSource(workspace));
    expect(missing.exitCode).toBe(1);
    expect(missing.report.findings).toEqual([{ code: "CONTRACT_VIOLATION", class: "DEFECT", targetKind: "CONFIG", targetId: "issue-links.json" }]);

    await writeFile(join(fixtureDirectory(workspace), "issue-links.json"), JSON.stringify({ links: "none" }));
    const invalid = await build(workspace, await realSource(workspace));
    expect(invalid.exitCode).toBe(1);
    expect(codesOf(invalid.report)).toEqual(["CONTRACT_VIOLATION"]);

    await writeFile(join(fixtureDirectory(workspace), "issue-links.json"), "{ not json");
    const unreadable = await build(workspace, await realSource(workspace));
    expect(unreadable.exitCode).toBe(1);
    expect(unreadable.report.findings).toEqual([{ code: "CONTRACT_VIOLATION", class: "DEFECT", targetKind: "BUNDLE", targetId: "issue-links.json" }]);
  });

  it("fails with QUESTION_ISSUE_INVALID, a shortage, for a question whose issue was withdrawn, and the question is not removed by itself", async () => {
    workspace = await createBuildWorkspace({}, { issueRecords: true });
    const { questionId } = await ids(workspace);
    await writeLinks(workspace, [{ targetKind: "QUESTION", targetId: questionId, issueId: POPULATION_ISSUE, issueVersion: 1 }]);
    const source = await realSource(workspace);
    expect((await build(workspace, source)).exitCode).toBe(0);

    await revokePopulationIssue(workspace);
    const result = await build(workspace, await realSource(workspace));
    expect(result.exitCode).toBe(1);
    expect(result.report.findings).toEqual([{ code: "QUESTION_ISSUE_INVALID", class: "SHORTAGE", targetKind: "QUESTION", targetId: questionId }]);
    await expect(readFile(bundlePath(workspace), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("takes a card whose issue was withdrawn as not approved: the card is not in the bundle, and the card on the disk is not changed", async () => {
    workspace = await createBuildWorkspace({}, { issueRecords: true });
    const { cardId } = await ids(workspace);
    await writeLinks(workspace, [{ targetKind: "ISSUE_CARD", targetId: cardId, issueId: POPULATION_ISSUE, issueVersion: 1 }]);
    const cardsBefore = await readFile(join(fixtureDirectory(workspace), "cards.json"), "utf8");
    await revokePopulationIssue(workspace);
    const result = await build(workspace, await realSource(workspace));
    expect(result.exitCode).toBe(1);
    expect(codesOf(result.report).some((code) => code === "CARD_NOT_APPROVED" || code === "CARD_COVERAGE_MISSING")).toBe(true);
    await expect(readFile(bundlePath(workspace), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(fixtureDirectory(workspace), "cards.json"), "utf8")).toBe(cardsBefore);
  });

  it("fails when the issues cannot be read", async () => {
    workspace = await createBuildWorkspace({}, { issueRecords: true });
    const result = await build(workspace, () => Promise.resolve(null));
    expect(result.exitCode).toBe(1);
    expect(result.report.findings).toEqual([{ code: "CONFIG_UNREADABLE", class: "DEFECT", targetKind: "CONFIG", targetId: "issues" }]);
  });

  it("does not read issues.json: a file there that is not a valid output changes nothing, and a build leaves it alone", async () => {
    workspace = await createBuildWorkspace({}, { issueRecords: true });
    const directory = join(workspace.root, "dist", "regional-values", "issues", "fixture");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "issues.json"), "{ not json");
    await writeFile(join(directory, "issues-export-report.json"), "{ not json");
    const source = await realSource(workspace);
    expect((await build(workspace, source)).exitCode).toBe(0);
    const first = await bundleText(workspace);
    await writeFile(join(directory, "issues.json"), "changed");
    expect((await build(workspace, source)).exitCode).toBe(0);
    expect(await bundleText(workspace)).toBe(first);
    expect(await readFile(join(directory, "issues.json"), "utf8")).toBe("changed");
  });

  describe("the numbers that the issues rest on are not in a question (Req 13.8)", () => {
    async function withNumberInQuestion(base: BuildWorkspace, number: string): Promise<void> {
      const path = join(fixtureDirectory(base), "question-bank.json");
      const bank = JSON.parse(await readFile(path, "utf8")) as { questions: { kind: string; explanation: string }[] };
      // The check is of a question that sets two directions side by side (a trade-off question).
      const tradeoff = bank.questions.find((question) => question.kind === "TRADEOFF" && question.explanation.includes("ここでは、"));
      if (tradeoff === undefined) {
        throw new Error("The bank has no trade-off question that the test can change");
      }
      // The number goes into the second sentence, so that the form of the explanation does not change.
      tradeoff.explanation = tradeoff.explanation.replace("ここでは、", `ここでは、${number}`);
      await writeFile(path, JSON.stringify(bank));
    }

    it("refuses a question that states the number of a fact of a valid issue, which no card has", async () => {
      workspace = await createBuildWorkspace({}, { issueRecords: true });
      await withNumberInQuestion(workspace, "480");
      // Without the issues, 480 is a number that no card has, so nothing is refused for it.
      expect((await build(workspace)).exitCode).toBe(0);
      const result = await build(workspace, await realSource(workspace));
      expect(result.exitCode).toBe(1);
      expect(codesOf(result.report)).toContain("NEUTRALITY_VIOLATION");
    });

    it("refuses a question that states the survey year of a fact of a valid issue", async () => {
      workspace = await createBuildWorkspace({}, { issueRecords: true });
      await withNumberInQuestion(workspace, "2023");
      expect((await build(workspace)).exitCode).toBe(0);
      expect((await build(workspace, await realSource(workspace))).exitCode).toBe(1);
    });

    it("does not count the number of an issue that is withdrawn", async () => {
      workspace = await createBuildWorkspace({}, { issueRecords: true });
      await withNumberInQuestion(workspace, "480");
      await revokePopulationIssue(workspace);
      expect((await build(workspace, await realSource(workspace))).exitCode).toBe(0);
    });
  });
});
