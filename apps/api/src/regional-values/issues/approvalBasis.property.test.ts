import type { FixtureFact } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { FIXTURE_FACTS } from "../../../../../tests/harness/regional-values/draftSupport.js";
import { createIssueWorld, fixtureIssue } from "../../../../../tests/harness/regional-values/issueSupport.js";

// Feature: regional-values-map, Property 62 (承認の根拠): an approval counts for the facts that it was made on, and only for them
// **Validates: Requirements 13.3, 13.5**
//
// The reference is a model of the rule that is written apart from the code: each approval keeps which version of each fact item it was made on,
// and the issue is valid exactly when some approval was made on the versions that the fact items have now. A fact item that is made again is
// another version of it; the record of the issue is never changed.

const FACT_1 = FIXTURE_FACTS[0] as FixtureFact;
const FACT_3 = FIXTURE_FACTS[2] as FixtureFact;
const VARIANTS = ["fictional-doc-1", "fictional-doc-2", "fictional-doc-3"] as const;

type Operation = Readonly<{ kind: "APPROVE"; approver: string }> | Readonly<{ kind: "REMAKE"; fact: 1 | 3; variant: number }>;

const operationArbitrary: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({ kind: fc.constant("APPROVE" as const), approver: fc.constantFrom("approver-a", "approver-b") }),
  fc.record({ kind: fc.constant("REMAKE" as const), fact: fc.constantFrom(1 as const, 3 as const), variant: fc.integer({ min: 0, max: VARIANTS.length - 1 }) }),
);

const PARAMETERS = { seed: 130_062, numRuns: 40 };
const HEAVY = 120_000;

function factsOf(state: Readonly<{ 1: number; 3: number }>): FixtureFact[] {
  return [
    { ...FACT_1, fictionalSourceId: VARIANTS[state[1]] as string },
    { ...FACT_3, fictionalSourceId: VARIANTS[state[3]] as string },
  ];
}

describe("an approval of an issue and the facts under it: properties", () => {
  it("counts an approval exactly when every fact item is the one that it was made on, whatever was made again in between", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(operationArbitrary, { minLength: 1, maxLength: 9 }), async (operations) => {
        const world = await createIssueWorld("FIXTURE");
        try {
          const state = { 1: 0, 3: 0 };
          await world.setFixtureFacts(factsOf(state));
          await world.addIssue(fixtureIssue());
          const approvals: { 1: number; 3: number }[] = [];
          for (const [index, operation] of operations.entries()) {
            if (operation.kind === "APPROVE") {
              await world.approve("issue-1", 1, operation.approver, new Date(Date.UTC(2026, 10, 13, 0, 0, index + 1)).toISOString());
              approvals.push({ 1: state[1], 3: state[3] });
            } else {
              state[operation.fact] = operation.variant;
              await world.setFixtureFacts(factsOf(state));
            }
          }
          const loaded = await world.load();
          expect(loaded.ok).toBe(true);
          if (!loaded.ok) {
            return;
          }
          const valid = approvals.some((made) => made[1] === state[1] && made[3] === state[3]);
          if (approvals.length === 0) {
            // Never approved: in neither list.
            expect(loaded.value.issues).toEqual([]);
            expect(loaded.value.withdrawn).toEqual([]);
          } else if (valid) {
            expect(loaded.value.withdrawn).toEqual([]);
            expect(loaded.value.issues.map((issue) => issue.issueId)).toEqual(["issue-1"]);
          } else {
            expect(loaded.value.issues).toEqual([]);
            expect(loaded.value.withdrawn).toEqual([{ issueId: "issue-1", version: 1, reason: "CONTENT_CHANGED" }]);
          }
        } finally {
          await world.remove();
        }
      }),
      PARAMETERS,
    );
  }, HEAVY);
});
