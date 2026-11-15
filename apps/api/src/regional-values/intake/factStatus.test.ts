import { unlink } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  COUNT_ROWS,
  SUM_SHELTERS,
  computedRequest,
  createVerifiedFact,
  takeInTable,
} from "../../../../../tests/harness/regional-values/factSupport.js";
import { createIntakeWorld } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import type { IntakeWorld } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import { encodeUtf8 } from "../../../../../tests/harness/regional-values/shiftJis.js";
import { listFactStatuses } from "./factStatus.js";
import { createComputedFact, createDerivedFact } from "./factValue.js";

// Fictional tables only. The status of a fact item is read, and nothing is written.

let world: IntakeWorld | undefined;

async function newWorld(): Promise<IntakeWorld> {
  world = await createIntakeWorld();
  return world;
}

afterEach(async () => {
  await world?.remove();
  world = undefined;
});

async function statusesOf(current: IntakeWorld) {
  const statuses = await listFactStatuses(current.store, {});
  if (!statuses.ok) {
    throw new Error(`The statuses were not read: ${statuses.error.cause}`);
  }
  return statuses.value;
}

describe("listFactStatuses", () => {
  it("is empty when there is no fact item", async () => {
    const current = await newWorld();
    expect(await listFactStatuses(current.store, {})).toEqual({ ok: true, value: [] });
  });

  it("says that a fact item that was just made is PROVISIONAL and ready to be verified, and that nothing is wrong with it", async () => {
    const current = await newWorld();
    await takeInTable(current);
    expect((await createComputedFact(current.store, computedRequest())).ok).toBe(true);
    expect(await statusesOf(current)).toEqual([
      {
        factId: "fact-rows",
        method: "COMPUTED",
        stored: "PROVISIONAL",
        effective: "PROVISIONAL",
        verifierId: null,
        verifiedAt: null,
        verifiable: true,
        recomputation: "OK",
        reason: null,
        findings: [],
        problems: [],
      },
    ]);
  });

  it("says that a fact item that a person verified is VERIFIED, with the person and the time, and that it is not offered again", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await createVerifiedFact(current, computedRequest(), "verifier-7");
    expect(await statusesOf(current)).toMatchObject([{ factId: "fact-rows", stored: "VERIFIED", effective: "VERIFIED", verifierId: "verifier-7", verifiedAt: "2026-11-13T00:00:00.000Z", verifiable: false, findings: [], problems: [] }]);
  });

  it("counts a fact item as PROVISIONAL, in spite of the file, when its original is not the file that it was made from (SOURCE_CHANGED)", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await createVerifiedFact(current, computedRequest());
    await current.putRaw("fictional-shelters/r1/shelters.csv", encodeUtf8("地区,種別,避難所数,人口\nあおば,洪水,99,1200人\n"));
    const [status] = await statusesOf(current);
    expect(status).toMatchObject({ stored: "VERIFIED", effective: "PROVISIONAL", verifiable: false, recomputation: "UNAVAILABLE", reason: "ORIGINAL_CHANGED", findings: ["SOURCE_CHANGED"] });
  });

  it("counts a fact item as PROVISIONAL when its stored value is not what the original gives (FACT_VALUE_MISMATCH)", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await createVerifiedFact(current, computedRequest());
    const fact = (await current.readJson(current.recordPath("facts/fact-rows.json"))) as { value: { amount: number; unit: string } };
    await current.putRecord("facts/fact-rows.json", { ...fact, value: { ...fact.value, amount: fact.value.amount + 1 } });
    const [status] = await statusesOf(current);
    expect(status).toMatchObject({ stored: "VERIFIED", effective: "PROVISIONAL", findings: ["FACT_VALUE_MISMATCH"] });
  });

  it("gives a reason for a computed fact item whose record of the computation is gone, and does not offer it", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await createComputedFact(current.store, computedRequest());
    await unlink(current.recordPath("aggregations/fact-rows.json"));
    expect(await statusesOf(current)).toMatchObject([{ stored: "PROVISIONAL", verifiable: false, problems: ["AGGREGATION_RECORD_MISSING"] }]);
  });

  it("lists the fact items in the order of their IDs, with the method of each, and a derived fact item of verified operands is ready to be verified", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await createVerifiedFact(current, computedRequest({ factId: "shelters", method: SUM_SHELTERS, subject: "避難所の数", unit: "か所" }));
    await createVerifiedFact(current, computedRequest({ factId: "areas", method: COUNT_ROWS, subject: "記録の数", unit: "か所" }));
    const derived = await createDerivedFact(current.store, {
      factId: "ratio",
      operation: "RATIO",
      operandFactIds: ["shelters", "areas"],
      unitPair: { numerator: "か所", denominator: "か所" },
      subject: "割合",
      description: "d",
    });
    expect(derived.ok, JSON.stringify(derived)).toBe(true);
    const statuses = await statusesOf(current);
    expect(statuses.map((status) => `${status.factId}:${status.method}:${status.effective}`)).toEqual(["areas:COMPUTED:VERIFIED", "ratio:DERIVED:PROVISIONAL", "shelters:COMPUTED:VERIFIED"]);
    expect(statuses[1]).toMatchObject({ factId: "ratio", verifiable: true, problems: [], findings: [] });
  });

  it("does not offer a derived fact item whose operand is not verified now (OPERAND_NOT_VERIFIED)", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await createVerifiedFact(current, computedRequest({ factId: "shelters", method: SUM_SHELTERS, subject: "避難所の数", unit: "か所" }));
    await createVerifiedFact(current, computedRequest({ factId: "areas", method: COUNT_ROWS, subject: "記録の数", unit: "か所" }));
    await createDerivedFact(current.store, { factId: "ratio", operation: "RATIO", operandFactIds: ["shelters", "areas"], unitPair: { numerator: "か所", denominator: "か所" }, subject: "割合", description: "d" });
    // The operand goes back to PROVISIONAL (a person's verification is taken away by hand).
    const operand = (await current.readJson(current.recordPath("facts/areas.json"))) as Record<string, unknown>;
    await current.putRecord("facts/areas.json", { ...operand, verification: { status: "PROVISIONAL" } });
    const ratio = (await statusesOf(current)).find((status) => status.factId === "ratio");
    expect(ratio).toMatchObject({ verifiable: false, problems: ["OPERAND_NOT_VERIFIED"] });
  });

  it("writes nothing", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await createComputedFact(current.store, computedRequest());
    const before = await Promise.all((await current.files()).map(async (path) => `${path}\u0000${path.startsWith("raw/") ? await current.readText(current.rawPath(path.slice(4))) : await current.readText(current.recordPath(path.slice(8)))}`));
    await statusesOf(current);
    const after = await Promise.all((await current.files()).map(async (path) => `${path}\u0000${path.startsWith("raw/") ? await current.readText(current.rawPath(path.slice(4))) : await current.readText(current.recordPath(path.slice(8)))}`));
    expect(after).toEqual(before);
  });
});
