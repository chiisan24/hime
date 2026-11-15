import { writeFile } from "node:fs/promises";

import { RealFactSchema } from "@ehime-vote-navigator/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createBuildWorkspace } from "../../../../tests/harness/regional-values/buildWorkspace.js";
import type { BuildWorkspace } from "../../../../tests/harness/regional-values/buildWorkspace.js";
import {
  COUNT_ROWS,
  SUM_SHELTERS,
  computedRequest,
  createVerifiedFact,
  takeInTable,
} from "../../../../tests/harness/regional-values/factSupport.js";
import { createIntakeWorld, renameWithRetry } from "../../../../tests/harness/regional-values/intakeSupport.js";
import type { IntakeWorld } from "../../../../tests/harness/regional-values/intakeSupport.js";
import { encodeUtf8 } from "../../../../tests/harness/regional-values/shiftJis.js";
import { runRegionalValuesCli } from "./cli.js";
import type { RegionalValuesCliOptions } from "./cli.js";
import { createComputedFact, createDerivedFact } from "./intake/factValue.js";
import { VERIFY_QUESTIONS } from "./intake/verifyFact.js";

// The people are functions that answer as a test says; the command never answers for a person.

const FIXED_NOW = new Date("2026-11-20T01:00:00.000Z");

let workspace: BuildWorkspace | undefined;
let world: IntakeWorld | undefined;

afterEach(async () => {
  await world?.remove();
  await workspace?.remove();
  workspace = undefined;
  world = undefined;
});

/** The records of real data are made in the workspace, where the command looks for them (`data/real/...`). */
async function prepare(override: Parameters<typeof createBuildWorkspace>[0] = {}): Promise<IntakeWorld> {
  workspace = await createBuildWorkspace(override);
  world = await createIntakeWorld({ base: workspace.root });
  await takeInTable(world);
  const made = await createComputedFact(world.store, computedRequest());
  expect(made.ok).toBe(true);
  return world;
}

type Run = Readonly<{ exitCode: number; lines: string[]; asked: string[] }>;

async function run(argv: readonly string[], options: Readonly<{ answers?: readonly boolean[]; noConfirm?: boolean; seams?: RegionalValuesCliOptions["verifyFact"] }> = {}): Promise<Run> {
  if (workspace === undefined) {
    throw new Error("prepare the workspace first");
  }
  const lines: string[] = [];
  const asked: string[] = [];
  const exitCode = await runRegionalValuesCli(argv, {
    workspaceRoot: workspace.root,
    io: {
      write: (line) => lines.push(line),
      ...(options.noConfirm === true
        ? {}
        : {
            confirm: (question: string) => {
              asked.push(question);
              return Promise.resolve(options.answers?.[asked.length - 1] === true);
            },
          }),
    },
    now: () => FIXED_NOW,
    logWriter: () => undefined,
    ...(options.seams === undefined ? {} : { verifyFact: options.seams }),
  });
  return { exitCode, lines, asked };
}

const VERIFY = ["verify-fact", "fact-rows", "--verifier", "verifier-1"] as const;

function factFile(current: IntakeWorld): string {
  return current.recordPath("facts/fact-rows.json");
}

describe("verify-fact: the person says yes", () => {
  it("shows the numbers, asks the two questions, writes VERIFIED with the person and the time, and exits with 0", async () => {
    const current = await prepare();
    const before = RealFactSchema.parse(await current.readJson(factFile(current)));
    const result = await run(VERIFY, { answers: [true, true] });
    expect(result.exitCode).toBe(0);
    expect(result.asked).toEqual([...VERIFY_QUESTIONS.value]);
    expect(result.lines.at(-1)).toBe("code=VERIFY_OK factId=fact-rows");
    expect(result.lines).toContain("stored amount=4 unit=件");
    expect(result.lines).toContain("recomputed amount=4 unit=件 missingCount=0 duplicatesRemoved=0");
    expect(result.lines).toContain("record missingCount=0 duplicatesRemoved=0");
    expect(result.lines).toContain("locator kind=text-lines startLine=2 endLine=5");
    const after = RealFactSchema.parse(await current.readJson(factFile(current)));
    expect(after).toEqual({ ...before, verification: { status: "VERIFIED", verifierId: "verifier-1", verifiedAt: "2026-11-20T01:00:00.000Z" } });
  });

  it("says that a fact item that is verified already needs nothing, and exits with 0 only if it still counts as verified", async () => {
    const current = await prepare();
    await run(VERIFY, { answers: [true, true] });
    const again = await run(VERIFY, { answers: [true, true] });
    expect(again.exitCode).toBe(0);
    expect(again.asked).toEqual([]);
    expect(again.lines.at(-1)).toBe("code=VERIFY_NOT_NEEDED status=ALREADY_VERIFIED effective=VERIFIED");

    await writeFile(current.rawPath("fictional-shelters/r1/shelters.csv"), encodeUtf8("地区,件数\nあおば,1\n"));
    const changed = await run(VERIFY, { answers: [true, true] });
    expect(changed.exitCode).toBe(1);
    expect(changed.lines).toContain("finding=SOURCE_CHANGED");
    expect(changed.lines.at(-1)).toBe("code=VERIFY_NOT_NEEDED status=ALREADY_VERIFIED effective=PROVISIONAL");
  });
});

describe("verify-fact: nothing is written without the yes of a person", () => {
  it.each([
    ["a no", [false], "VERIFY_FAILED reason=CANCELLED"],
    ["a yes and a no", [true, false], "VERIFY_FAILED reason=CANCELLED"],
    ["no answer", [], "VERIFY_FAILED reason=CANCELLED"],
  ])("exits with 1 and writes nothing for %s", async (_name, answers, code) => {
    const current = await prepare();
    const text = await current.readText(factFile(current));
    const result = await run(VERIFY, { answers });
    expect(result.exitCode).toBe(1);
    expect(result.lines.at(-1)).toBe(`code=${code}`);
    expect(await current.readText(factFile(current))).toBe(text);
  });

  it("exits with 1 and writes nothing when there is no way to ask (no input)", async () => {
    const current = await prepare();
    const text = await current.readText(factFile(current));
    const result = await run(VERIFY, { noConfirm: true });
    expect(result.exitCode).toBe(1);
    expect(result.asked).toEqual([]);
    expect(result.lines.at(-1)).toBe("code=VERIFY_FAILED reason=CANCELLED");
    expect(await current.readText(factFile(current))).toBe(text);
  });

  it("has no option that answers for the person", async () => {
    const current = await prepare();
    const text = await current.readText(factFile(current));
    for (const option of ["--yes", "--force", "--assume-yes", "-y", "--no-confirm", "--verified"]) {
      const result = await run([...VERIFY, option]);
      expect(result.exitCode, option).toBe(1);
      expect(result.lines.at(-1), option).toBe("code=ARGUMENT_INVALID");
      expect(result.asked, option).toEqual([]);
    }
    expect(await current.readText(factFile(current))).toBe(text);
  });
});

describe("verify-fact: arguments", () => {
  it.each([
    ["no fact ID", ["verify-fact", "--verifier", "verifier-1"]],
    ["no person", ["verify-fact", "fact-rows"]],
    ["nothing", ["verify-fact"]],
    ["two fact IDs", ["verify-fact", "fact-rows", "other", "--verifier", "verifier-1"]],
    ["a repeated person", ["verify-fact", "fact-rows", "--verifier", "a", "--verifier", "b"]],
    ["a person without a value", ["verify-fact", "fact-rows", "--verifier"]],
    ["a person followed by an option", ["verify-fact", "fact-rows", "--verifier", "--config-dir", "x"]],
    ["an unknown option", ["verify-fact", "fact-rows", "--verifier", "verifier-1", "--data-kind", "REAL_AI"]],
  ])("exits with 1 with the usage and the code for %s, and asks nothing", async (_name, argv) => {
    const current = await prepare();
    const text = await current.readText(factFile(current));
    const result = await run(argv, { answers: [true, true] });
    expect(result.exitCode).toBe(1);
    expect(result.lines.at(-1)).toBe("code=ARGUMENT_INVALID");
    expect(result.lines[0]).toMatch(/^Usage: npm run regional-values -- verify-fact /u);
    expect(result.asked).toEqual([]);
    expect(await current.readText(factFile(current))).toBe(text);
  });

  it("refuses a fact ID that is a path, a person that is blank or too long, and a fact item that is not there", async () => {
    await prepare();
    expect((await run(["verify-fact", "../fact-rows", "--verifier", "verifier-1"])).lines.at(-1)).toBe("code=VERIFY_FAILED reason=FACT_ID_INVALID");
    expect((await run(["verify-fact", "fact-rows", "--verifier", " "])).lines.at(-1)).toBe("code=VERIFY_FAILED reason=VERIFIER_INVALID");
    expect((await run(["verify-fact", "fact-rows", "--verifier", "v".repeat(65)])).lines.at(-1)).toBe("code=VERIFY_FAILED reason=VERIFIER_INVALID");
    expect((await run(["verify-fact", "no-such-fact", "--verifier", "verifier-1"])).lines.at(-1)).toBe("code=VERIFY_FAILED reason=FACT_NOT_FOUND");
  });

  it("stops with CONFIG_UNREADABLE when the settings cannot be read, and asks nothing", async () => {
    const current = await prepare({ build: null });
    const text = await current.readText(factFile(current));
    const result = await run(VERIFY, { answers: [true, true] });
    expect(result).toEqual({ exitCode: 1, lines: ["code=CONFIG_UNREADABLE"], asked: [] });
    expect(await current.readText(factFile(current))).toBe(text);
  });
});

describe("verify-fact: a fact item that is not offered", () => {
  it("prints the codes of the checks that failed, asks nothing and exits with 1", async () => {
    const current = await prepare();
    const fact = RealFactSchema.parse(await current.readJson(factFile(current)));
    await current.putRecord("facts/fact-rows.json", { ...fact, value: { amount: 5, unit: "件" } });
    const text = await current.readText(factFile(current));
    const result = await run(VERIFY, { answers: [true, true] });
    expect(result.exitCode).toBe(1);
    expect(result.asked).toEqual([]);
    expect(result.lines.slice(-2)).toEqual(["finding=FACT_VALUE_MISMATCH", "code=VERIFY_FAILED reason=CHECK_FAILED"]);
    expect(result.lines).toContain("stored amount=5 unit=件");
    expect(await current.readText(factFile(current))).toBe(text);
  });

  it("prints a code for a problem of the record, and for a store that cannot be read", async () => {
    const current = await prepare();
    await renameWithRetry(current.recordPath("aggregations/fact-rows.json"), current.recordPath("aggregations/moved.json"));
    const mismatch = await run(VERIFY, { answers: [true, true] });
    expect(mismatch.exitCode).toBe(1);
    expect(mismatch.lines.at(-1)).toBe("code=VERIFY_FAILED reason=STORE_READ_FAILED cause=PATH_MISMATCH");

    await renameWithRetry(current.recordPath("aggregations/moved.json"), current.recordPath("aggregations/fact-rows.json"));
    await writeFile(current.recordPath("aggregations/fact-rows.json"), "{ not json", "utf8");
    const broken = await run(VERIFY, { answers: [true, true] });
    expect(broken.lines.at(-1)).toBe("code=VERIFY_FAILED reason=STORE_READ_FAILED cause=RECORD_INVALID");
  });

  it("uses the lists of the settings: a proper noun that the area and the definition do not have is refused", async () => {
    workspace = await createBuildWorkspace();
    world = await createIntakeWorld({ base: workspace.root });
    await takeInTable(world);
    // Made without the lists: the sentence names 松山市, which is a proper noun of the settings and is not in the area.
    const made = await createComputedFact(world.store, computedRequest({ area: "愛媛県", subject: "松山市の避難所の記録の数" }));
    expect(made.ok).toBe(true);
    const result = await run(VERIFY, { answers: [true, true] });
    expect(result.exitCode).toBe(1);
    expect(result.lines).toContain("finding=FACT_VALUE_MISMATCH");
    expect(result.lines).toContain("problem=SENTENCE_PROPER_NOUN_NOT_GROUNDED");
    expect(result.asked).toEqual([]);
  });
});

describe("verify-fact: a derived fact item and the files", () => {
  it("is verified with the questions about the operands and the formula", async () => {
    workspace = await createBuildWorkspace();
    world = await createIntakeWorld({ base: workspace.root });
    await takeInTable(world);
    await createVerifiedFact(world, computedRequest({ factId: "shelters", method: SUM_SHELTERS, subject: "避難所の数", unit: "か所" }));
    await createVerifiedFact(world, computedRequest({ factId: "areas", method: COUNT_ROWS, subject: "記録の数", unit: "か所" }));
    const derived = await createDerivedFact(world.store, {
      factId: "ratio",
      operation: "RATIO",
      operandFactIds: ["shelters", "areas"],
      unitPair: { numerator: "か所", denominator: "か所" },
      subject: "避難所の記録に対する割合",
      description: "避難所の数を記録の数で割った割合",
    });
    expect(derived.ok).toBe(true);
    const result = await run(["verify-fact", "ratio", "--verifier", "verifier-2"], { answers: [true, true] });
    expect(result.exitCode).toBe(0);
    expect(result.asked).toEqual([...VERIFY_QUESTIONS.derived]);
    expect(result.lines).toContain("formula=operand1 / operand2 * 100 decimals=2 rounding=half-away-from-zero");
    expect(result.lines.at(-1)).toBe("code=VERIFY_OK factId=ratio");
  });

  it("prints only the codes, the numbers and the lines that the person compares: every line is one of three shapes", async () => {
    await prepare();
    const result = await run(VERIFY, { answers: [true, true] });
    for (const line of result.lines) {
      expect(line, line).toMatch(
        /^(?:code=[A-Z_]+(?: [A-Za-z]+=[A-Za-z0-9_-]+)*|finding=[A-Z_]+|problem=[A-Z_]+|fact=.+ method=.+ status=.+|source .+|survey=.+ area=.+|stored amount=.+|recomputed .+|record .+|quoted found=true|locator kind=.+|sentence=.+|operand[12] .+|unitPair .+|formula=.+)$/u,
      );
    }
  });

  it("does not change the other commands: an unknown command is still the usage", async () => {
    await prepare();
    const result = await run(["verify-facts", "fact-rows"]);
    expect(result.exitCode).toBe(1);
    expect(result.lines.at(-1)).toBe("code=USAGE");
  });
});
