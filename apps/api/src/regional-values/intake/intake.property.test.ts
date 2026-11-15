import { sha256Hex } from "@ehime-vote-navigator/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { FAST_OPERATIONS, createIntakeWorld, failRenameTo, intakeRequest } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import { encodeUtf8 } from "../../../../../tests/harness/regional-values/shiftJis.js";
import { intakeCsv } from "./intake.js";
import type { IntakeRequest } from "./intake.js";
import { readRealSources } from "./sourceRecords.js";

// Feature: regional-values-map, Property 59 (入口側の補足): 取り込みの版、重複、失敗時の安全
// **Validates: Requirements 7.5, 7.14, 10.15**
//
// The reference is a model of what the rule says, written apart from the intake: a list of the
// SHA-256 of each revision for each source ID, and the three rules (the same as the latest revision is
// UNCHANGED, another source ID that holds the SHA-256 is a duplicate, anything else is the next revision).

const PARAMETERS = { seed: 130_010, numRuns: 100 };
/** A run makes a temporary directory and many files; the limit is for a machine that is busy with other tests. */
const HEAVY = 120_000;
const CLOCK = (): Date => new Date("2026-11-13T00:00:00Z");

const SOURCE_IDS = ["alpha", "beta", "gamma"] as const;

function tableOf(index: number): Uint8Array {
  return encodeUtf8(`名称,件数\nあおば,${index}\n`);
}

type Operation = Readonly<{ sourceId: (typeof SOURCE_IDS)[number]; content: number }>;

const operationsArbitrary = fc.array(fc.record({ sourceId: fc.constantFrom(...SOURCE_IDS), content: fc.integer({ min: 0, max: 3 }) }), { minLength: 1, maxLength: 8 });

function requestOf(operation: Operation): IntakeRequest {
  return intakeRequest({ sourceId: operation.sourceId, fileName: `${operation.sourceId}.csv`, bytes: tableOf(operation.content) });
}

describe("intakeCsv: properties", () => {
  it("follows the rules of the revision and of the duplicate for any sequence of files and source IDs", async () => {
    await fc.assert(
      fc.asyncProperty(operationsArbitrary, async (operations) => {
        const world = await createIntakeWorld({ operations: FAST_OPERATIONS });
        try {
          const history = new Map<string, string[]>();
          for (const operation of operations) {
            const sha = sha256Hex(tableOf(operation.content));
            const revisions = history.get(operation.sourceId) ?? [];
            const holders = SOURCE_IDS.filter((id) => id !== operation.sourceId && (history.get(id) ?? []).includes(sha));
            const result = await intakeCsv(world.store, requestOf(operation), CLOCK);
            if (revisions.at(-1) === sha) {
              expect(result.ok && result.value.status).toBe("UNCHANGED");
              expect(result.ok && result.value.source.revision).toBe(`r${revisions.length}`);
            } else if (holders.length > 0) {
              expect(result).toEqual({ ok: false, error: { code: "DUPLICATE_CONTENT", existingSourceId: holders[0] } });
            } else {
              expect(result.ok && result.value.status).toBe("CREATED");
              expect(result.ok && result.value.source.revision).toBe(`r${revisions.length + 1}`);
              history.set(operation.sourceId, [...revisions, sha]);
            }
          }

          // What is on the disk is what the model says: one placed file and one record for each revision, and nothing else.
          const expectedFiles: string[] = [];
          for (const [sourceId, shas] of history) {
            shas.forEach((_sha, index) => {
              expectedFiles.push(`raw/${sourceId}/r${index + 1}/${sourceId}.csv`, `records/sources/${sourceId}/r${index + 1}.json`);
            });
          }
          expect(await world.files()).toEqual(expectedFiles.sort());
          const stored = await readRealSources(world.store);
          expect(stored.ok).toBe(true);
          if (stored.ok) {
            for (const source of stored.value) {
              expect(source.sha256).toBe(history.get(source.sourceId)?.[Number(source.revision.slice(1)) - 1]);
            }
            expect(stored.value.length).toBe([...history.values()].reduce((sum, shas) => sum + shas.length, 0));
          }
          // The SHA-256 of a file is held by one source ID.
          const holdersOf = new Map<string, Set<string>>();
          for (const [sourceId, shas] of history) {
            for (const sha of shas) {
              holdersOf.set(sha, (holdersOf.get(sha) ?? new Set()).add(sourceId));
            }
          }
          for (const holders of holdersOf.values()) {
            expect(holders.size).toBe(1);
          }
        } finally {
          await world.remove();
        }
      }),
      PARAMETERS,
    );
  }, HEAVY);

  it("leaves nothing when a write fails, wherever it fails, and the same request then works", async () => {
    const stages = {
      placement: (path: string) => path.endsWith(".csv"),
      source: (path: string) => path.endsWith(".json") && !path.replaceAll("\\", "/").includes("/datasets/"),
      ledger: (path: string) => path.replaceAll("\\", "/").includes("/datasets/"),
    } as const;
    await fc.assert(
      fc.asyncProperty(operationsArbitrary, fc.constantFrom("placement", "source", "ledger"), async (operations, stage) => {
        const world = await createIntakeWorld({ operations: FAST_OPERATIONS });
        try {
          const dataset = { title: "架空の避難所一覧", sourceUrl: "https://example.org/dataset/shelters", surveyDate: "2026-07-27", updatedOn: null, coverageArea: "架空県", themeIds: ["TRANSPORT"] } as const;
          for (const operation of operations) {
            const earlier = await intakeCsv(world.store, { ...requestOf(operation), dataset }, CLOCK);
            // The sequence is the setup of the check, so it must not fail by a fault of the store: a file that another source ID holds is the only refusal.
            expect(earlier.ok || earlier.error.code === "DUPLICATE_CONTENT", JSON.stringify(earlier)).toBe(true);
          }
          // A source ID and a content that the sequence does not use, so that the last intake makes a record, a file and a ledger change.
          const last: IntakeRequest = { ...intakeRequest({ sourceId: "delta", fileName: "delta.csv", bytes: tableOf(100) }), dataset };
          const before = await world.files();
          const ledgerBefore = await Promise.all((await world.files()).filter((path) => path.startsWith("records/datasets/")).map((path) => world.readText(world.recordPath(path.slice("records/".length)))));

          const failed = await intakeCsv(world.storeWith({ ...FAST_OPERATIONS, ...failRenameTo(stages[stage]) }), last, CLOCK);
          expect(failed.ok).toBe(false);
          expect(!failed.ok && failed.error.code).toBe("STORE_WRITE_FAILED");
          expect(!failed.ok && failed.error.leftovers).toBeUndefined();
          expect(await world.files()).toEqual(before);
          const ledgerAfter = await Promise.all((await world.files()).filter((path) => path.startsWith("records/datasets/")).map((path) => world.readText(world.recordPath(path.slice("records/".length)))));
          expect(ledgerAfter).toEqual(ledgerBefore);

          const retried = await intakeCsv(world.store, last, CLOCK);
          expect(retried.ok, JSON.stringify(retried)).toBe(true);
          expect(retried.ok && retried.value.status).toBe("CREATED");
          expect(retried.ok && retried.value.source.revision).toBe("r1");
          expect(retried.ok && retried.value.ledger).toBe(ledgerBefore.length === 0 ? "CREATED" : "UPDATED");
        } finally {
          await world.remove();
        }
      }),
      PARAMETERS,
    );
  }, HEAVY);

  it("never writes a file when the source ID is refused, whatever the file is", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("", "A", "a_b", "con", "a/b", "..", "x".repeat(65)), fc.integer({ min: 0, max: 5 }), async (sourceId, content) => {
        const world = await createIntakeWorld();
        try {
          const result = await intakeCsv(world.store, intakeRequest({ sourceId, bytes: tableOf(content) }), CLOCK);
          expect(result).toEqual({ ok: false, error: { code: "SOURCE_ID_INVALID" } });
          expect(await world.files()).toEqual([]);
        } finally {
          await world.remove();
        }
      }),
      PARAMETERS,
    );
  });
});
