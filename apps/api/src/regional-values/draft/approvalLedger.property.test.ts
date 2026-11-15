import { ApprovalLedgerRecordSchema } from "@ehime-vote-navigator/contracts";
import type { ApprovalLedgerRecord } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { hashOfName } from "../../../../../tests/harness/regional-values/draftSupport.js";
import { countValidApprovals } from "./approvalLedger.js";

const RUNS = 300;

const HASHES = [hashOfName("content-1"), hashOfName("content-2"), hashOfName("content-3")] as const;
const APPROVERS = ["a", "b", "c", "d"] as const;
const BASE = Date.parse("2026-11-13T00:00:00Z");

type Operation =
  | Readonly<{ type: "APPROVE"; approver: (typeof APPROVERS)[number]; hash: number; minute: number }>
  | Readonly<{ type: "REVOKE"; hash: number; minute: number }>;

const operationArbitrary: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({
    type: fc.constant("APPROVE" as const),
    approver: fc.constantFrom(...APPROVERS),
    hash: fc.integer({ min: 0, max: 2 }),
    minute: fc.integer({ min: 0, max: 12 }),
  }),
  fc.record({ type: fc.constant("REVOKE" as const), hash: fc.integer({ min: 0, max: 2 }), minute: fc.integer({ min: 0, max: 12 }) }),
);

function recordOf(operation: Operation): ApprovalLedgerRecord {
  const at = new Date(BASE + operation.minute * 60_000).toISOString();
  const target = { targetKind: "CARD", targetId: "card-1", targetHash: HASHES[operation.hash] };
  return ApprovalLedgerRecordSchema.parse(
    operation.type === "APPROVE"
      ? { type: "APPROVE", ...target, approverId: operation.approver, approvedAt: at }
      : { type: "REVOKE", ...target, revokerId: "reviewer-9", revokedAt: at },
  );
}

/** The rule written again, one approver at a time: an approval counts when no revocation of its content is as late as it or later. */
function referenceApprovers(operations: readonly Operation[], hash: number): string[] {
  const revocations = operations.filter((operation) => operation.type === "REVOKE" && operation.hash === hash).map((operation) => operation.minute);
  const counted = new Set<string>();
  for (const operation of operations) {
    if (operation.type === "APPROVE" && operation.hash === hash && revocations.every((minute) => minute < operation.minute)) {
      counted.add(operation.approver);
    }
  }
  return [...counted].sort();
}

describe("Property 31: the number of approvers", () => {
  /** **Validates: Requirements 3.10, 7.1, 8.27, 10.5** */
  it("is enough only when the different approvers of the current content reach the number that is required", () => {
    fc.assert(
      fc.property(fc.array(operationArbitrary, { maxLength: 25 }), fc.integer({ min: 0, max: 2 }), fc.integer({ min: 1, max: 4 }), (operations, hash, required) => {
        const records = operations.map(recordOf);
        const expected = referenceApprovers(operations, hash);
        const result = countValidApprovals(records, { targetKind: "CARD", targetId: "card-1", targetHash: HASHES[hash] as string }, required);
        if (expected.length >= required) {
          expect(result).toEqual({ ok: true, value: { approverIds: expected } });
        } else {
          expect(result).toEqual({ ok: false, error: { code: "APPROVER_COUNT_INSUFFICIENT", approverCount: expected.length, requiredApprovers: required } });
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("makes the records of the earlier content invalid when the content changes", () => {
    fc.assert(
      fc.property(fc.array(operationArbitrary, { maxLength: 25 }), (operations) => {
        // Only the content 0 has records; the content as it is now is another one.
        const onlyFirst = operations.filter((operation) => operation.hash === 0).map(recordOf);
        const result = countValidApprovals(onlyFirst, { targetKind: "CARD", targetId: "card-1", targetHash: HASHES[2] as string }, 1);
        expect(result).toEqual({ ok: false, error: { code: "APPROVER_COUNT_INSUFFICIENT", approverCount: 0, requiredApprovers: 1 } });
      }),
      { numRuns: RUNS },
    );
  });

  it("does not depend on the order in which the records are read", () => {
    fc.assert(
      fc.property(fc.array(operationArbitrary, { maxLength: 25 }), fc.integer({ min: 0, max: 2 }), fc.nat(), (operations, hash, seed) => {
        const records = operations.map(recordOf);
        const query = { targetKind: "CARD", targetId: "card-1", targetHash: HASHES[hash] as string } as const;
        const turn = records.length === 0 ? 0 : seed % records.length;
        const rotated = [...records.slice(turn), ...records.slice(0, turn)];
        const expected = countValidApprovals(records, query, 2);
        expect(countValidApprovals(rotated, query, 2)).toEqual(expected);
        expect(countValidApprovals([...records].reverse(), query, 2)).toEqual(expected);
      }),
      { numRuns: RUNS },
    );
  });

  it("counts a person once: adding an approval by a person who approved already does not change the result", () => {
    fc.assert(
      fc.property(fc.array(operationArbitrary, { maxLength: 20 }), fc.integer({ min: 0, max: 2 }), (operations, hash) => {
        const query = { targetKind: "CARD", targetId: "card-1", targetHash: HASHES[hash] as string } as const;
        const before = countValidApprovals(operations.map(recordOf), query, 1);
        const approvers = referenceApprovers(operations, hash);
        fc.pre(approvers.length > 0);
        const again: Operation = { type: "APPROVE", approver: approvers[0] as (typeof APPROVERS)[number], hash, minute: 13 };
        const after = countValidApprovals([...operations, again].map(recordOf), query, 1);
        expect(after).toEqual(before);
      }),
      { numRuns: RUNS },
    );
  });
});
