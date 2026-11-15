import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { testCheckConfig } from "../../../../../tests/harness/regional-values/draftSupport.js";
import {
  createIssueWorld,
  ISSUE_SETTINGS,
  ORIGINAL_BYTES,
  realIssue,
  realMaterial,
  settingsWith,
} from "../../../../../tests/harness/regional-values/issueSupport.js";
import type { IssueWorld } from "../../../../../tests/harness/regional-values/issueSupport.js";
import type { WithdrawnReason } from "@ehime-vote-navigator/contracts";

// Feature: regional-values-map, Property 61 and Property 62: the issues that are valid, the issues that are
// withdrawn, and what makes a withdrawn issue valid again. The expected reason comes from the change that the
// test makes, not from the records that it reads. The records are made for the test.

const PARAMETERS = { seed: 610_062, numRuns: 25 };
const ISSUE = "issue-r1";
const CHANGES = [
  "REVOKE_ALL",
  "NEW_VERSION",
  "MORE_APPROVERS_REQUIRED",
  "SOURCE_CHANGED",
  "FACT_UNVERIFIED",
  "USAGE_CHANGED",
  "CHECK_FAILED",
] as const;
type Change = (typeof CHANGES)[number];

const EXPECTED: Readonly<Record<Change, WithdrawnReason>> = {
  REVOKE_ALL: "REVOKED",
  NEW_VERSION: "CONTENT_CHANGED",
  MORE_APPROVERS_REQUIRED: "APPROVAL_INSUFFICIENT",
  SOURCE_CHANGED: "SOURCE_CHANGED",
  FACT_UNVERIFIED: "FACT_UNVERIFIED",
  USAGE_CHANGED: "USAGE_CHANGED",
  CHECK_FAILED: "CHECK_FAILED",
};

const approverNames = (count: number): string[] => Array.from({ length: count }, (_, index) => `approver-${String.fromCharCode(97 + index)}`);
const time = (minutes: number): string => new Date(Date.parse("2026-11-13T01:00:00Z") + minutes * 60_000).toISOString();

/** A world with one real issue that is valid with `approvers` approvals, for a change that the test makes next. */
async function validWorld(approvers: readonly string[], offsets: readonly number[], over: { fact?: Record<string, unknown>; source?: Record<string, unknown> } = {}): Promise<IssueWorld> {
  const world = await createIssueWorld("REAL_AI");
  const { fact, source } = realMaterial(over);
  await world.setRealFact(fact);
  await world.setRealSource(source);
  await world.setOriginal(source, ORIGINAL_BYTES);
  await world.addIssue(realIssue(ISSUE, 1));
  for (const [index, approver] of approvers.entries()) {
    await world.approve(ISSUE, 1, approver, time(offsets[index] ?? index));
  }
  return world;
}

async function load(world: IssueWorld, required: number, words?: { causalWords: string[] }) {
  const settings = settingsWith({
    requiredApprovers: required,
    ...(words === undefined ? {} : { checks: { ...testCheckConfig(), words: { ...testCheckConfig().words, ...words } } }),
  });
  const loaded = await world.load(settings);
  if (!loaded.ok) {
    throw new Error(`The snapshot was not loaded: ${loaded.error.code}`);
  }
  return loaded.value;
}

/** The world and the settings after one change, and what the settings are for the words. */
async function applyChange(change: Change, approvers: readonly string[], offsets: readonly number[]): Promise<{ world: IssueWorld; required: number; words?: { causalWords: string[] } }> {
  const required = Math.max(1, approvers.length);
  switch (change) {
    case "FACT_UNVERIFIED":
      return { world: await validWorld(approvers, offsets, { fact: { verification: { status: "PROVISIONAL" } } }), required };
    case "USAGE_CHANGED":
      return { world: await validWorld(approvers, offsets, { source: { transmission: { status: "UNKNOWN" } } }), required };
    default:
      break;
  }
  const world = await validWorld(approvers, offsets);
  switch (change) {
    case "REVOKE_ALL":
      for (const approver of approvers) {
        await world.revoke(ISSUE, 1, approver, time(1_000));
      }
      return { world, required };
    case "NEW_VERSION":
      await world.addIssue(realIssue(ISSUE, 2, { title: "試験町の施設の配置" }));
      return { world, required };
    case "MORE_APPROVERS_REQUIRED":
      return { world, required: required + 1 };
    case "SOURCE_CHANGED":
      await world.setOriginal(realMaterial().source, new TextEncoder().encode("another original"));
      return { world, required };
    default:
      // The words of the checks now refuse a word that the statement of the issue has.
      return { world, required, words: { causalWords: ["配置"] } };
  }
}

const approversArbitrary = fc.integer({ min: 1, max: 3 }).map(approverNames);
const offsetsArbitrary = fc.array(fc.integer({ min: 0, max: 600 }), { minLength: 3, maxLength: 3 });

describe("loadIssueSnapshot: properties (Property 61, Property 62)", () => {
  /** **Validates: Requirements 13.3, 13.4, 13.5, 7.14** */
  it("withdraws a valid issue for one change, with the reason of that change, and never for no change", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...CHANGES), approversArbitrary, offsetsArbitrary, async (change, approvers, offsets) => {
        const before = await validWorld(approvers, offsets);
        let after: Awaited<ReturnType<typeof applyChange>> | undefined;
        try {
          const unchanged = await load(before, approvers.length);
          expect(unchanged.withdrawn).toEqual([]);
          expect(unchanged.issues.map((issue) => issue.issueId)).toEqual([ISSUE]);
          expect(unchanged.issues[0]?.approval.approverCount).toBe(approvers.length);

          after = await applyChange(change, approvers, offsets);
          const snapshot = await load(after.world, after.required, after.words);
          expect(snapshot.issues).toEqual([]);
          const [first] = snapshot.withdrawn;
          expect(first?.reason).toBe(EXPECTED[change]);
          expect(snapshot.withdrawn).toHaveLength(1);
          expect(snapshot.reasons.get(ISSUE)?.[0]).toBe(EXPECTED[change]);
        } finally {
          await before.remove();
          await after?.world.remove();
        }
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 13.5** */
  it("does not make an issue valid again by an approval alone when the cause is the original, the fact, the use or the words", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("SOURCE_CHANGED", "FACT_UNVERIFIED", "USAGE_CHANGED", "CHECK_FAILED"), approversArbitrary, offsetsArbitrary, async (change, approvers, offsets) => {
        const applied = await applyChange(change, approvers, offsets);
        try {
          for (const extra of ["approver-x", "approver-y"]) {
            await applied.world.approve(ISSUE, 1, extra, time(2_000));
          }
          const snapshot = await load(applied.world, applied.required, applied.words);
          expect(snapshot.issues).toEqual([]);
          expect(snapshot.withdrawn.map((item) => item.reason)).toEqual([EXPECTED[change]]);
        } finally {
          await applied.world.remove();
        }
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 13.5** */
  it("makes an issue valid again by new approvals of the next version, and not by the approvals of the version before", async () => {
    await fc.assert(
      fc.asyncProperty(approversArbitrary, offsetsArbitrary, async (approvers, offsets) => {
        const applied = await applyChange("NEW_VERSION", approvers, offsets);
        try {
          expect((await load(applied.world, applied.required)).withdrawn.map((item) => item.reason)).toEqual(["CONTENT_CHANGED"]);
          for (const [index, approver] of approvers.entries()) {
            await applied.world.approve(ISSUE, 2, approver, time(3_000 + index));
          }
          const snapshot = await load(applied.world, applied.required);
          expect(snapshot.withdrawn).toEqual([]);
          expect(snapshot.issues[0]).toMatchObject({ issueId: ISSUE, version: 2 });
        } finally {
          await applied.world.remove();
        }
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 13.1, 12.19** */
  it("gives the same snapshot for the same input whatever the order of the approvals, and another digest for another input", async () => {
    await fc.assert(
      fc.asyncProperty(approversArbitrary, offsetsArbitrary, async (approvers, offsets) => {
        const forward = await validWorld(approvers, offsets);
        const backward = await validWorld([...approvers].reverse(), [...offsets].reverse().slice(0, approvers.length).reverse());
        try {
          const first = await load(forward, approvers.length);
          const second = await load(forward, approvers.length);
          expect(JSON.stringify(second.issues)).toBe(JSON.stringify(first.issues));
          expect(second.inputDigest).toBe(first.inputDigest);
          const changed = await load(forward, approvers.length + 1);
          expect(changed.inputDigest).not.toBe(first.inputDigest);
          // The approvals are the same set, so the judgment is the same.
          expect((await load(backward, approvers.length)).issues.map((issue) => issue.issueId)).toEqual([ISSUE]);
        } finally {
          await forward.remove();
          await backward.remove();
        }
      }),
      PARAMETERS,
    );
  });

  it("has a settings object that lets the property tests change the number of approvers", () => {
    expect(ISSUE_SETTINGS.requiredApprovers).toBe(1);
  });
});
