import type { RealFact, RealSource } from "@ehime-vote-navigator/contracts";
import type { ComputedMethod } from "@ehime-vote-navigator/domain";

import { createComputedFact } from "../../../apps/api/src/regional-values/intake/factValue.js";
import type { ComputedFactRequest } from "../../../apps/api/src/regional-values/intake/factValue.js";
import { intakeCsv } from "../../../apps/api/src/regional-values/intake/intake.js";
import type { IntakeRequest } from "../../../apps/api/src/regional-values/intake/intake.js";
import { verifyFact } from "../../../apps/api/src/regional-values/intake/verifyFact.js";
import type { IntakeWorld } from "./intakeSupport.js";
import { intakeRequest } from "./intakeSupport.js";
import { overridden } from "./override.js";
import type { Override } from "./override.js";
import { encodeUtf8 } from "./shiftJis.js";

/**
 * Test harness for the fact items of real data (13.11). The table, the area and the numbers are
 * fictional. A "human" here is a function that answers the questions of `verify-fact` as the test says; the
 * code never answers for a person, and a test that wants a fact item to be verified says so with `verifiedBy`.
 */

/** Four rows. 避難所数 has no unit; 人口 has the unit 人, and one cell of it is blank. */
export const FACT_TABLE = "地区,種別,避難所数,人口\nあおば,洪水,12,1200人\nみなと,洪水,7,800人\nひなた,地震,3,\nあおば,地震,5,300人\n";

export const CLOCK = (): Date => new Date("2026-11-13T00:00:00Z");

/** The source that is taken in. It throws if the intake refuses, because the test needs the source. */
export async function takeInTable(world: IntakeWorld, text: string = FACT_TABLE, over: Override<IntakeRequest> = {}): Promise<RealSource> {
  const result = await intakeCsv(world.store, intakeRequest({ bytes: encodeUtf8(text), ...over }), CLOCK);
  if (!result.ok) {
    throw new Error(`The intake was refused: ${result.error.code}`);
  }
  return result.value.source;
}

export const COUNT_ROWS: ComputedMethod = { kind: "COMPUTED", aggregation: "COUNT_ROWS", column: null, equals: null, description: "データ行の数" };

export const COUNT_FLOOD: ComputedMethod = { kind: "COMPUTED", aggregation: "COUNT_ROWS_WHERE", column: "種別", equals: "洪水", description: "種別が洪水の行の数" };

export const SUM_SHELTERS: ComputedMethod = {
  kind: "COMPUTED",
  aggregation: "SUM_COLUMN",
  column: "避難所数",
  whereColumn: null,
  equals: null,
  description: "避難所数の合計",
};

export const SUM_POPULATION: ComputedMethod = {
  kind: "COMPUTED",
  aggregation: "SUM_COLUMN",
  column: "人口",
  whereColumn: null,
  equals: null,
  description: "人口の合計",
};

export function computedRequest(over: Override<ComputedFactRequest> = {}): ComputedFactRequest {
  return overridden<ComputedFactRequest>(
    {
      factId: "fact-rows",
      sourceId: "fictional-shelters",
      method: COUNT_ROWS,
      surveyDate: "2026-07-27",
      area: "架空県",
      subject: "避難所の記録の数",
      unit: "件",
    },
    over,
  );
}

/** The questions that `verifyFact` asks, and the answers of a fake person. */
export type FakeHuman = Readonly<{
  confirm: (question: string) => Promise<boolean>;
  /** Every question that was asked, in order. */
  asked: readonly string[];
}>;

/** A person who answers the questions in turn: `true` for a yes. After the answers, the answer is no. */
export function fakeHuman(answers: readonly boolean[]): FakeHuman {
  const asked: string[] = [];
  return {
    asked,
    confirm: (question) => {
      asked.push(question);
      return Promise.resolve(answers[asked.length - 1] === true);
    },
  };
}

/** Makes a fact item and has a fake person verify it. For a test that needs a verified fact item as a premise. */
export async function createVerifiedFact(world: IntakeWorld, request: ComputedFactRequest, verifierId = "verifier-1"): Promise<RealFact> {
  const created = await createComputedFact(world.store, request);
  if (!created.ok) {
    throw new Error(`The fact item was refused: ${created.error.code}`);
  }
  const human = fakeHuman([true, true]);
  const verified = await verifyFact(world.store, { factId: request.factId, verifierId }, { now: CLOCK, confirm: human.confirm, write: () => undefined });
  if (!verified.ok || verified.value.status !== "VERIFIED") {
    throw new Error("The fact item was not verified");
  }
  return verified.value.fact;
}
