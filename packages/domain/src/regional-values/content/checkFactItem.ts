import { FactItemSchema } from "@ehime-vote-navigator/contracts";
import type { FactItem, GateFinding } from "@ehime-vote-navigator/contracts";

import { gateFinding } from "./gateFinding.js";

/** A fact item of fictional data. The type excludes a real one, so that no check is skipped silently. */
export type FixtureFactItem = Extract<FactItem, { dataKind: "FIXTURE" }>;

/**
 * The checks of a fact item of fictional data (Req 7.18). A fictional fact has the sentence, the
 * value, the date, the area and a fictional document ID only, so the one check that applies is
 * the contract. The checks of a real fact (source, original value, verification) are separate
 * functions (13.11, 13.12) and are not run here.
 *
 * A value that is not a fact of fictional data, although the type says so, is a defect of the
 * caller and is reported, not passed.
 */
export function checkFixtureFactItem(fact: FixtureFactItem): GateFinding[] {
  const parsed = FactItemSchema.safeParse(fact);
  if (!parsed.success) {
    return [gateFinding("CONTRACT_VIOLATION", "FACT_ITEM", fact.factId)];
  }
  if (parsed.data.dataKind !== "FIXTURE") {
    return [gateFinding("DATA_KIND_INVALID", "FACT_ITEM", fact.factId)];
  }
  return [];
}
