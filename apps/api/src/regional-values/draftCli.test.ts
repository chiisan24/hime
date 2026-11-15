import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createBuildWorkspace } from "../../../../tests/harness/regional-values/buildWorkspace.js";
import type { BuildWorkspace } from "../../../../tests/harness/regional-values/buildWorkspace.js";
import {
  FIXTURE_FACTS,
  TEST_MODELS,
  TEST_THEMES,
  TEST_WORDS,
  createClock,
  createFakeClient,
  passingCandidate,
  passingSummary,
  realFact,
  realSource,
} from "../../../../tests/harness/regional-values/draftSupport.js";
import type { FakeClient } from "../../../../tests/harness/regional-values/draftSupport.js";
import { runRegionalValuesCli } from "./cli.js";
import { ISSUE_CONFIRMATION_QUESTIONS } from "./draftCli.js";

let workspace: BuildWorkspace | undefined;

afterEach(async () => {
  await workspace?.remove();
  workspace = undefined;
});

type Run = Readonly<{ exitCode: number; lines: string[]; asked: string[] }>;

const SETTINGS = {
  maxEvidenceUnits: 10,
  evidenceMaxChars: 400,
  sentenceMaxChars: 60,
  causalWords: [...TEST_WORDS.causalWords],
  hedgeEndings: [...TEST_WORDS.hedgeEndings],
  comparisonWords: [...TEST_WORDS.comparisonWords],
  themes: TEST_THEMES,
};

const CANDIDATE_SPEC = { dataKind: "FIXTURE", facts: [FIXTURE_FACTS[0], FIXTURE_FACTS[2]], evidence: [], sources: [] };

async function prepare(): Promise<BuildWorkspace> {
  workspace = await createBuildWorkspace();
  await writeFile(join(workspace.root, "settings.json"), JSON.stringify(SETTINGS), "utf8");
  await writeFile(join(workspace.root, "candidate.json"), JSON.stringify(CANDIDATE_SPEC), "utf8");
  return workspace;
}

async function put(base: BuildWorkspace, name: string, value: unknown): Promise<void> {
  await writeFile(join(base.root, name), JSON.stringify(value), "utf8");
}

type Options = Readonly<{ fake?: FakeClient; answers?: readonly boolean[]; noConfirm?: boolean }>;

async function run(argv: readonly string[], base: BuildWorkspace, options: Options = {}): Promise<Run> {
  const lines: string[] = [];
  const asked: string[] = [];
  let answered = 0;
  const fake = options.fake ?? createFakeClient([JSON.stringify(passingCandidate())]);
  const exitCode = await runRegionalValuesCli(argv, {
    workspaceRoot: base.root,
    io: {
      write: (line) => lines.push(line),
      ...(options.noConfirm === true
        ? {}
        : {
            confirm: (question: string) => {
              asked.push(question);
              const answer = options.answers?.[answered] ?? true;
              answered += 1;
              return Promise.resolve(answer);
            },
          }),
    },
    now: createClock("2026-11-20T00:00:00.000Z", 60_000),
    logWriter: () => undefined,
    draft: {
      client: fake.client,
      pacer: { wait: () => Promise.resolve() },
      models: TEST_MODELS,
      isElectionBulletin: () => Promise.resolve(false),
    },
  });
  return { exitCode, lines, asked };
}

const RUN_ARGS = ["draft", "run", "--task", "ISSUE_CANDIDATE", "--input", "candidate.json", "--draft-settings", "settings.json"] as const;

function lineStarting(result: Run, prefix: string): string | undefined {
  return result.lines.find((line) => line.startsWith(prefix));
}

function draftIdOf(result: Run): string {
  const match = /draftId=([0-9a-f]{64})/u.exec(lineStarting(result, "code=DRAFT_OK") ?? "");
  if (match?.[1] === undefined) {
    throw new Error("the run was expected to save a draft");
  }
  return match[1];
}

describe("draft run", () => {
  it("runs a draft, saves it, and prints the code, the ID and whether it was kept from before", async () => {
    const base = await prepare();
    const fake = createFakeClient([JSON.stringify(passingCandidate())]);
    const first = await run(RUN_ARGS, base, { fake });
    expect(first.exitCode).toBe(0);
    expect(first.lines).toEqual([expect.stringMatching(/^code=DRAFT_OK draftId=[0-9a-f]{64} task=ISSUE_CANDIDATE cached=false$/u)]);
    expect(fake.calls).toHaveLength(1);
    expect(await readdir(join(base.root, "packages", "fixtures", "src", "regional-values", "drafts", "ISSUE_CANDIDATE"))).toHaveLength(1);

    const second = await run(RUN_ARGS, base, { fake });
    expect(second.exitCode).toBe(0);
    expect(second.lines[0]).toMatch(/cached=true$/u);
    expect(fake.calls).toHaveLength(1);
  });

  it("runs the tasks that write a card from the quotations of the request", async () => {
    const base = await prepare();
    await put(base, "summary.json", { dataKind: "FIXTURE", facts: [], evidence: [{ evidenceId: "E1", sourceId: "fictional-doc-1", locator: { kind: "text-lines", startLine: 1, endLine: 2 }, text: "架空市では、2025年度にバス路線が12本運行された。" }], sources: [] });
    const result = await run(["draft", "run", "--task", "ISSUE_SUMMARY", "--input", "summary.json", "--draft-settings", "settings.json"], base, {
      fake: createFakeClient([JSON.stringify(passingSummary())]),
    });
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toContain("task=ISSUE_SUMMARY");
  });

  it("prints every reason when the input is refused, and does not call the model", async () => {
    const base = await prepare();
    await put(base, "real.json", {
      dataKind: "REAL_AI",
      facts: [realFact("real-1", { verification: { status: "PROVISIONAL" } })],
      evidence: [],
      sources: [realSource({ transmission: { status: "UNKNOWN" } })],
    });
    const fake = createFakeClient([JSON.stringify(passingCandidate())]);
    const result = await run(["draft", "run", "--task", "ISSUE_CANDIDATE", "--input", "real.json", "--draft-settings", "settings.json"], base, { fake });
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["code=DRAFT_FAILED reason=INPUT_REFUSED", "reasons=FACT_NOT_VERIFIED,TRANSMISSION_NOT_ALLOWED"]);
    expect(fake.calls).toHaveLength(0);
  });

  it("prints the check and the place when the output is refused, and never the text of the output", async () => {
    const base = await prepare();
    const wrong = JSON.stringify(passingCandidate({ factSummary: [{ text: "架空市のバス路線は13本である", groundFactIds: ["fx-1"] }] }));
    const result = await run(RUN_ARGS, base, { fake: createFakeClient([wrong]) });
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["code=DRAFT_FAILED reason=CHECK_FAILED", "violation=DR_CANDIDATE_FACTS:factSummary[0]"]);
  });

  it("prints a code for a failure of the model", async () => {
    const base = await prepare();
    const result = await run(RUN_ARGS, base, { fake: createFakeClient([{ code: "TIMEOUT" }]) });
    expect(result).toMatchObject({ exitCode: 1, lines: ["code=DRAFT_FAILED reason=TIMEOUT"] });
  });

  it("exits with 1 and a code for a wrong argument, a file that cannot be read and settings that cannot be used", async () => {
    const base = await prepare();
    const wrong: readonly (readonly string[])[] = [
      ["draft", "run"],
      ["draft", "run", "--task", "NO_SUCH_TASK", "--input", "candidate.json", "--draft-settings", "settings.json"],
      ["draft", "run", "--task", "ISSUE_CANDIDATE", "--draft-settings", "settings.json"],
      ["draft", "run", "--task", "ISSUE_CANDIDATE", "--input", "candidate.json"],
      [...RUN_ARGS, "--unknown", "x"],
      [...RUN_ARGS, "--task", "ISSUE_SUMMARY"],
      ["draft", "run", "--task", "ISSUE_CANDIDATE", "--input", "missing.json", "--draft-settings", "settings.json"],
      ["draft", "run", "extra", "--task", "ISSUE_CANDIDATE", "--input", "candidate.json", "--draft-settings", "settings.json"],
    ];
    for (const argv of wrong) {
      const result = await run(argv, base);
      expect(result.exitCode, argv.join(" ")).toBe(1);
      expect(result.lines, argv.join(" ")).toEqual(["code=ARGUMENT_INVALID"]);
    }
    await put(base, "other-task.json", { ...CANDIDATE_SPEC, task: "ISSUE_SUMMARY" });
    expect((await run(["draft", "run", "--task", "ISSUE_CANDIDATE", "--input", "other-task.json", "--draft-settings", "settings.json"], base)).lines).toEqual(["code=ARGUMENT_INVALID"]);
    await put(base, "no-kind.json", { facts: [], evidence: [], sources: [] });
    expect((await run(["draft", "run", "--task", "ISSUE_CANDIDATE", "--input", "no-kind.json", "--draft-settings", "settings.json"], base)).lines).toEqual(["code=ARGUMENT_INVALID"]);

    await put(base, "bad-settings.json", { ...SETTINGS, sentenceMaxChars: 100 });
    expect(await run(["draft", "run", "--task", "ISSUE_CANDIDATE", "--input", "candidate.json", "--draft-settings", "bad-settings.json"], base)).toMatchObject({
      exitCode: 1,
      lines: ["code=CONFIG_UNREADABLE"],
    });
  });

  it("refuses a request that has a field of a user, with the code of the request", async () => {
    const base = await prepare();
    await put(base, "with-answers.json", { ...CANDIDATE_SPEC, answers: [] });
    const result = await run(["draft", "run", "--task", "ISSUE_CANDIDATE", "--input", "with-answers.json", "--draft-settings", "settings.json"], base);
    expect(result).toMatchObject({ exitCode: 1, lines: ["code=DRAFT_FAILED reason=REQUEST_INVALID"] });
  });
});

describe("draft list", () => {
  async function twoCandidatesAndOther(base: BuildWorkspace): Promise<readonly string[]> {
    const ids: string[] = [];
    const variants: readonly [string, Record<string, unknown>][] = [
      ["a.json", { ...CANDIDATE_SPEC, topic: "題材A" }],
      ["b.json", { ...CANDIDATE_SPEC, topic: "題材B" }],
      ["c.json", { ...CANDIDATE_SPEC, topic: "題材C" }],
    ];
    const outputs = [passingCandidate(), passingCandidate({ title: "別の題名" }), passingCandidate({ themeId: "DISASTER_PREVENTION" })];
    for (const [index, [name, spec]] of variants.entries()) {
      await put(base, name, spec);
      const result = await run(["draft", "run", "--task", "ISSUE_CANDIDATE", "--input", name, "--draft-settings", "settings.json"], base, {
        fake: createFakeClient([JSON.stringify(outputs[index])]),
      });
      ids.push(draftIdOf(result));
    }
    return ids;
  }

  it("lists the candidates apart from the other drafts, and says which may be the same issue, without merging or deleting", async () => {
    const base = await prepare();
    const [first, second, third] = await twoCandidatesAndOther(base);
    await put(base, "summary.json", { dataKind: "FIXTURE", facts: [], evidence: [{ evidenceId: "E1", sourceId: "fictional-doc-1", locator: { kind: "text-lines", startLine: 1, endLine: 2 }, text: "架空市では、2025年度にバス路線が12本運行された。" }], sources: [] });
    const summary = draftIdOf(
      await run(["draft", "run", "--task", "ISSUE_SUMMARY", "--input", "summary.json", "--draft-settings", "settings.json"], base, { fake: createFakeClient([JSON.stringify(passingSummary())]) }),
    );

    const result = await run(["draft", "list", "--data-kind", "FIXTURE"], base);
    expect(result.exitCode).toBe(0);
    const draftsAt = result.lines.indexOf("section=drafts");
    const candidatesAt = result.lines.findIndex((line) => line.startsWith("section=issue-candidates"));
    expect(draftsAt).toBeGreaterThanOrEqual(0);
    expect(candidatesAt).toBeGreaterThan(draftsAt);
    expect(result.lines.slice(draftsAt + 1, candidatesAt)).toEqual([expect.stringContaining(`draft=${summary} task=ISSUE_SUMMARY status=PENDING`)]);
    const candidates = result.lines.slice(candidatesAt + 1, -1);
    expect(candidates).toHaveLength(3);
    // The first and the second rest on the same facts in the same theme; the third is in another theme.
    expect(candidates.find((line) => line.includes(`candidate=${first}`))).toContain("possible-duplicate=group-1");
    expect(candidates.find((line) => line.includes(`candidate=${second}`))).toContain("possible-duplicate=group-1");
    expect(candidates.find((line) => line.includes(`candidate=${third}`))).toContain("possible-duplicate=none");
    expect(result.lines.at(-1)).toBe("code=LIST_OK count=4");
    // Nothing is removed by listing: the three candidates are still there.
    expect(await readdir(join(base.root, "packages", "fixtures", "src", "regional-values", "drafts", "ISSUE_CANDIDATE"))).toHaveLength(3);
  });

  it("filters by the state that is derived from the records", async () => {
    const base = await prepare();
    const [first, second] = await twoCandidatesAndOther(base);
    const review = ["draft", "review", first as string, "--task", "ISSUE_CANDIDATE", "--data-kind", "FIXTURE", "--reviewer", "reviewer-1", "--reject"];
    expect((await run(review, base)).exitCode).toBe(0);
    const pending = await run(["draft", "list", "--data-kind", "FIXTURE", "--status", "PENDING"], base);
    expect(pending.lines.join("\n")).not.toContain(first as string);
    expect(pending.lines.join("\n")).toContain(second as string);
    const rejected = await run(["draft", "list", "--data-kind", "FIXTURE", "--status", "REJECTED"], base);
    expect(rejected.lines.join("\n")).toContain(`candidate=${first} status=REJECTED`);
    expect((await run(["draft", "list", "--data-kind", "FIXTURE", "--status", "DELETED"], base)).lines).toEqual(["code=ARGUMENT_INVALID"]);
  });

  it("lists nothing for a data kind that has no drafts, and needs the data kind", async () => {
    const base = await prepare();
    const empty = await run(["draft", "list", "--data-kind", "REAL_AI"], base);
    expect(empty.lines).toEqual(["section=drafts", "section=issue-candidates (proposals, not facts)", "code=LIST_OK count=0"]);
    expect((await run(["draft", "list"], base)).lines).toEqual(["code=ARGUMENT_INVALID"]);
  });
});

describe("draft review and draft counts", () => {
  const review = (draftId: string, ...rest: string[]): string[] => ["draft", "review", draftId, "--task", "ISSUE_CANDIDATE", "--data-kind", "FIXTURE", "--reviewer", "reviewer-1", ...rest];

  async function oneDraft(base: BuildWorkspace, output: unknown = passingCandidate()): Promise<string> {
    return draftIdOf(await run(RUN_ARGS, base, { fake: createFakeClient([JSON.stringify(output)]) }));
  }

  it("adopts a candidate as an issue and rejects another, and prints the kind of the record", async () => {
    const base = await prepare();
    const draftId = await oneDraft(base);
    const adopted = await run(review(draftId, "--adopt", "--target-kind", "ISSUE", "--target-id", "issue-1"), base);
    expect(adopted).toMatchObject({ exitCode: 0, lines: ["code=REVIEW_OK event=HUMAN_ADOPTED"] });
    expect(JSON.parse(await readFile(join(base.root, "packages", "fixtures", "src", "regional-values", "issues", "issue-1", "v1.json"), "utf8"))).toMatchObject({ issueId: "issue-1", version: 1 });

    const again = await run(review(draftId, "--reject"), base);
    expect(again).toMatchObject({ exitCode: 1, lines: ["code=REVIEW_FAILED reason=DECISION_ALREADY_MADE"] });

    await put(base, "other.json", { ...CANDIDATE_SPEC, topic: "別の題材" });
    const otherId = draftIdOf(
      await run(["draft", "run", "--task", "ISSUE_CANDIDATE", "--input", "other.json", "--draft-settings", "settings.json"], base, {
        fake: createFakeClient([JSON.stringify(passingCandidate({ title: "別の題名" }))]),
      }),
    );
    expect(await run(review(otherId, "--reject"), base)).toMatchObject({ exitCode: 0, lines: ["code=REVIEW_OK event=HUMAN_REJECTED"] });
  });

  it("counts the four numbers from the records", async () => {
    const base = await prepare();
    expect((await run(["draft", "counts", "--data-kind", "FIXTURE"], base)).lines).toEqual(["aiContribution drafted=0 rejectedByChecks=0 humanEdited=0 humanRejected=0", "code=COUNTS_OK"]);
    const draftId = await oneDraft(base);
    await run(review(draftId, "--reject"), base);
    const wrong = JSON.stringify(passingCandidate({ factSummary: [{ text: "架空市のバス路線は13本である", groundFactIds: ["fx-1"] }] }));
    await put(base, "other.json", { ...CANDIDATE_SPEC, topic: "別の題材" });
    await run(["draft", "run", "--task", "ISSUE_CANDIDATE", "--input", "other.json", "--draft-settings", "settings.json"], base, { fake: createFakeClient([wrong]) });
    expect((await run(["draft", "counts", "--data-kind", "FIXTURE"], base)).lines).toEqual(["aiContribution drafted=2 rejectedByChecks=1 humanEdited=0 humanRejected=1", "code=COUNTS_OK"]);
    expect((await run(["draft", "counts", "--data-kind", "REAL_AI"], base)).lines).toEqual(["aiContribution drafted=0 rejectedByChecks=0 humanEdited=0 humanRejected=0", "code=COUNTS_OK"]);
  });

  it("does not adopt a change of a person without the input of the draft, and checks the change with it", async () => {
    const base = await prepare();
    const draftId = await oneDraft(base);
    await put(base, "edited.json", passingCandidate({ title: "架空市のバス路線の本数" }));
    const adopt = review(draftId, "--adopt", "--target-kind", "ISSUE", "--target-id", "issue-1", "--edited", "edited.json");
    expect(await run(adopt, base)).toMatchObject({ exitCode: 1, lines: ["code=REVIEW_FAILED reason=RECHECK_CONTEXT_MISSING"] });

    await put(base, "violating.json", passingCandidate({ statement: "推奨語の路線を確かめたい仮説語尾" }));
    const withInput = ["--input", "candidate.json", "--draft-settings", "settings.json"];
    const violating = review(draftId, "--adopt", "--target-kind", "ISSUE", "--target-id", "issue-1", "--edited", "violating.json", ...withInput);
    expect(await run(violating, base)).toMatchObject({ exitCode: 1, lines: ["code=REVIEW_FAILED reason=RECHECK_FAILED", "violation=DR_FORBIDDEN_WORDS:statement"] });

    const good = review(draftId, "--adopt", "--target-kind", "ISSUE", "--target-id", "issue-1", "--edited", "edited.json", ...withInput);
    expect(await run(good, base)).toMatchObject({ exitCode: 0, lines: ["code=REVIEW_OK event=HUMAN_EDITED"] });
    expect((await run(["draft", "counts", "--data-kind", "FIXTURE"], base)).lines[0]).toBe("aiContribution drafted=1 rejectedByChecks=0 humanEdited=1 humanRejected=0");
  });

  it("asks for the theme of a candidate that has none", async () => {
    const base = await prepare();
    const draftId = await oneDraft(base, passingCandidate({ themeId: "UNCLASSIFIED" }));
    const withInput = ["--input", "candidate.json", "--draft-settings", "settings.json"];
    const adopt = review(draftId, "--adopt", "--target-kind", "ISSUE", "--target-id", "issue-1", ...withInput);
    expect(await run(adopt, base)).toMatchObject({ exitCode: 1, lines: ["code=REVIEW_FAILED reason=THEME_NOT_DECIDED"] });
    expect(await run([...adopt, "--theme", "SPORTS"], base)).toMatchObject({ exitCode: 1, lines: ["code=ARGUMENT_INVALID"] });
    expect(await run([...adopt, "--theme", "TRANSPORT"], base)).toMatchObject({ exitCode: 0, lines: ["code=REVIEW_OK event=HUMAN_EDITED"] });
  });

  it("exits with 1 and a code for a wrong argument", async () => {
    const base = await prepare();
    const draftId = await oneDraft(base);
    const wrong: readonly (readonly string[])[] = [
      ["draft", "review"],
      review(draftId),
      review(draftId, "--adopt", "--reject"),
      review(draftId, "--adopt"),
      review(draftId, "--adopt", "--target-kind", "NOT_A_KIND", "--target-id", "x"),
      review(draftId, "--adopt", "--target-kind", "ISSUE"),
      ["draft", "review", draftId, "--task", "ISSUE_CANDIDATE", "--reviewer", "reviewer-1", "--reject"],
      ["draft", "counts"],
      ["draft", "counts", "--data-kind", "FIXTURE", "--data-kind", "REAL_AI"],
    ];
    for (const argv of wrong) {
      const result = await run(argv, base);
      expect(result, argv.join(" ")).toMatchObject({ exitCode: 1, lines: ["code=ARGUMENT_INVALID"] });
    }
    expect((await run(["draft", "unknown"], base)).lines.at(-1)).toBe("code=USAGE");
  });
});

describe("approve", () => {
  const approve = (...rest: string[]): string[] => ["approve", "ISSUE", "issue-1", "--data-kind", "FIXTURE", "--approver", "approver-1", ...rest];

  async function adoptedIssue(base: BuildWorkspace): Promise<void> {
    const draftId = draftIdOf(await run(RUN_ARGS, base));
    await run(["draft", "review", draftId, "--task", "ISSUE_CANDIDATE", "--data-kind", "FIXTURE", "--reviewer", "reviewer-1", "--adopt", "--target-kind", "ISSUE", "--target-id", "issue-1"], base);
  }

  async function ledgerFiles(base: BuildWorkspace): Promise<string[]> {
    try {
      return await readdir(join(base.root, "packages", "fixtures", "src", "regional-values", "approvals", "ISSUE", "issue-1"));
    } catch {
      return [];
    }
  }

  it("asks the six confirmations, and writes the approval only when every answer is yes", async () => {
    const base = await prepare();
    await adoptedIssue(base);
    const result = await run(approve("--version", "1"), base);
    expect(result).toMatchObject({ exitCode: 0, lines: ["code=APPROVE_OK"] });
    expect(result.asked).toEqual(ISSUE_CONFIRMATION_QUESTIONS.map(([, question]) => question));
    expect(result.asked).toHaveLength(6);
    const files = await ledgerFiles(base);
    expect(files).toHaveLength(1);
    const record = JSON.parse(await readFile(join(base.root, "packages", "fixtures", "src", "regional-values", "approvals", "ISSUE", "issue-1", files[0] as string), "utf8"));
    expect(record).toMatchObject({ type: "APPROVE", targetKind: "ISSUE", targetVersion: 1, approverId: "approver-1" });
    expect(Object.values(record.issueChecks)).toEqual([true, true, true, true, true, true]);
  });

  it("stops at the first answer that is not yes, and writes nothing", async () => {
    const base = await prepare();
    await adoptedIssue(base);
    for (const index of [0, 2, 5]) {
      const answers = [true, true, true, true, true, true].map((value, position) => (position === index ? false : value));
      const result = await run(approve("--version", "1"), base, { answers });
      expect(result).toMatchObject({ exitCode: 1, lines: ["code=APPROVE_CANCELLED"] });
      expect(result.asked).toHaveLength(index + 1);
    }
    expect(await ledgerFiles(base)).toEqual([]);
  });

  it("writes nothing when there is no one to ask", async () => {
    const base = await prepare();
    await adoptedIssue(base);
    expect(await run(approve("--version", "1"), base, { noConfirm: true })).toMatchObject({ exitCode: 1, lines: ["code=APPROVE_CANCELLED"] });
    expect(await ledgerFiles(base)).toEqual([]);
  });

  it("revokes an approval by adding a record, without the confirmations", async () => {
    const base = await prepare();
    await adoptedIssue(base);
    await run(approve("--version", "1"), base);
    const result = await run(approve("--version", "1", "--revoke"), base);
    expect(result).toMatchObject({ exitCode: 0, lines: ["code=REVOKE_OK"], asked: [] });
    expect(await ledgerFiles(base)).toHaveLength(2);
  });

  it("approves a target that is not an issue by the hash of its content, and asks for no confirmation", async () => {
    const base = await prepare();
    const hash = "e".repeat(64);
    const result = await run(["approve", "CARD", "card-1", "--data-kind", "FIXTURE", "--approver", "approver-1", "--target-hash", hash], base);
    expect(result).toMatchObject({ exitCode: 0, lines: ["code=APPROVE_OK"], asked: [] });
  });

  it("fails with a code for a version that does not exist", async () => {
    const base = await prepare();
    await adoptedIssue(base);
    expect(await run(approve("--version", "2"), base)).toMatchObject({ exitCode: 1, lines: ["code=APPROVE_FAILED reason=TARGET_NOT_FOUND"] });
  });

  it("exits with 1 and a code for a wrong argument", async () => {
    const base = await prepare();
    const wrong: readonly (readonly string[])[] = [
      ["approve"],
      ["approve", "ISSUE"],
      approve(),
      approve("--version", "0"),
      approve("--version", "1.5"),
      approve("--version", "one"),
      ["approve", "NOT_A_KIND", "x", "--data-kind", "FIXTURE", "--approver", "a", "--target-hash", "e".repeat(64)],
      ["approve", "CARD", "card-1", "--data-kind", "FIXTURE", "--approver", "a"],
      ["approve", "CARD", "card-1", "--data-kind", "FIXTURE", "--approver", "a", "--target-hash", "e".repeat(64), "--version", "1"],
      ["approve", "ISSUE", "issue-1", "--approver", "a", "--version", "1"],
      ["approve", "ISSUE", "issue-1", "--data-kind", "FIXTURE", "--version", "1"],
    ];
    for (const argv of wrong) {
      const result = await run(argv, base);
      expect(result, argv.join(" ")).toMatchObject({ exitCode: 1, lines: ["code=ARGUMENT_INVALID"], asked: [] });
    }
  });
});

describe("the output of the commands", () => {
  it("is made of fixed codes, IDs and counts: never a sentence of a fact, a candidate or a prompt", async () => {
    const base = await prepare();
    const outputs: string[] = [];
    outputs.push(...(await run(RUN_ARGS, base)).lines);
    outputs.push(...(await run(["draft", "list", "--data-kind", "FIXTURE"], base)).lines);
    outputs.push(...(await run(["draft", "counts", "--data-kind", "FIXTURE"], base)).lines);
    const text = outputs.join("\n");
    for (const secret of ["架空市", "バス路線", "確かめたい", "<<<DATA>>>", "利用者の数"]) {
      expect(text).not.toContain(secret);
    }
  });
});
