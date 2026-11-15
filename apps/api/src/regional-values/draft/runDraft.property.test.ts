import { readdir } from "node:fs/promises";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { BedrockConverseError } from "../../aws/bedrockConverse.js";
import {
  TEST_MODELS,
  candidateRequest,
  createFakeClient,
  createTempRoot,
  createTestDeps,
  passingCandidate,
  passingSummary,
  summaryRequest,
} from "../../../../../tests/harness/regional-values/draftSupport.js";
import { readAiContribution } from "./contribution.js";
import { runDraft } from "./runDraft.js";

const RUNS = 25;

const topicArbitrary = fc.string({ minLength: 1, maxLength: 40 }).filter((text) => !text.includes("<<<") && !text.includes(">>>"));

/** A response that fits the request: a candidate for the candidate, a summary for the summary. */
const respond = (call: { text: string }): string => (call.text.includes("evidenceId") ? JSON.stringify(passingSummary()) : JSON.stringify(passingCandidate()));

async function filesIn(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function withRoot<T>(use: (root: Awaited<ReturnType<typeof createTempRoot>>["root"]) => Promise<T>): Promise<T> {
  const temp = await createTempRoot("FIXTURE");
  try {
    return await use(temp.root);
  } finally {
    await temp.remove();
  }
}

describe("Property 29: the same key is not run twice", () => {
  /** **Validates: Requirements 8.8, 8.17** */
  it("returns the saved draft the second time, with no call and no new record", async () => {
    await fc.assert(
      fc.asyncProperty(topicArbitrary, fc.boolean(), async (topic, card) => {
        await withRoot(async (root) => {
          const fake = createFakeClient(respond);
          const { deps, waits } = createTestDeps(root, fake.client);
          const request = card ? summaryRequest({ topic }) : candidateRequest({ topic });
          const first = await runDraft(deps, request);
          const eventsAfterFirst = await filesIn(join(root.rootDir, "events"));
          const contribution = await readAiContribution(deps.store);
          const second = await runDraft(deps, request);

          expect(first.ok && second.ok).toBe(true);
          if (first.ok && second.ok) {
            expect(second.value.draftId).toBe(first.value.draftId);
            expect(first.value.cached).toBe(false);
            expect(second.value.cached).toBe(true);
          }
          expect(fake.calls).toHaveLength(1);
          expect(waits()).toBe(1);
          expect(await filesIn(join(root.rootDir, "events"))).toEqual(eventsAfterFirst);
          expect(await readAiContribution(deps.store)).toEqual(contribution);
        });
      }),
      { numRuns: RUNS },
    );
  });

  it("calls again, with another draft ID, when any part of the key is different", async () => {
    await fc.assert(
      fc.asyncProperty(topicArbitrary, topicArbitrary, async (first, second) => {
        fc.pre(first !== second);
        await withRoot(async (root) => {
          const fake = createFakeClient(respond);
          const { deps } = createTestDeps(root, fake.client);
          const base = await runDraft(deps, candidateRequest({ topic: first }));
          const otherInput = await runDraft(deps, candidateRequest({ topic: second }));
          const otherModel = await runDraft({ ...deps, models: { ...TEST_MODELS, generation: TEST_MODELS.verification } }, candidateRequest({ topic: first }));
          const otherTask = await runDraft(deps, summaryRequest({ topic: first }));

          const results = [base, otherInput, otherModel, otherTask];
          for (const result of results) {
            expect(result.ok && result.value.cached).toBe(false);
          }
          expect(fake.calls).toHaveLength(4);
          const ids = results.flatMap((result) => (result.ok ? [result.value.draftId] : []));
          expect(new Set(ids).size).toBe(4);
        });
      }),
      { numRuns: RUNS },
    );
  });

  it("does not take a failed run for a saved draft, whatever the failure was", async () => {
    const failures: readonly BedrockConverseError[] = [
      { code: "TIMEOUT" },
      { code: "TOKEN_INVALID" },
      { code: "HTTP_ERROR", status: 500 },
      { code: "NETWORK_ERROR" },
      { code: "RESPONSE_INVALID" },
      { code: "BUSY" },
      { code: "RATE_LIMITED" },
    ];
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...failures), fc.integer({ min: 1, max: 3 }), async (failure, times) => {
        await withRoot(async (root) => {
          const fake = createFakeClient((_call, index) => (index < times ? failure : JSON.stringify(passingCandidate())));
          const { deps } = createTestDeps(root, fake.client);
          for (let attempt = 0; attempt < times; attempt += 1) {
            const failed = await runDraft(deps, candidateRequest());
            expect(failed.ok).toBe(false);
            expect(await filesIn(join(root.rootDir, "drafts"))).toEqual([]);
            expect(await filesIn(join(root.rootDir, "events"))).toEqual([]);
          }
          const saved = await runDraft(deps, candidateRequest());
          expect(saved.ok && saved.value.cached).toBe(false);
          expect(fake.calls).toHaveLength(times + 1);
          const again = await runDraft(deps, candidateRequest());
          expect(again.ok && again.value.cached).toBe(true);
          expect(fake.calls).toHaveLength(times + 1);
        });
      }),
      { numRuns: RUNS },
    );
  });
});

describe("Properties 27 and 60 (the whole run): a refused output is counted and is not saved", () => {
  it("adds one to the drafted and the rejected, saves nothing, and keeps a draft that was saved before", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 13, max: 90 }), topicArbitrary, async (wrongNumber, topic) => {
        await withRoot(async (root) => {
          const wrong = JSON.stringify(passingCandidate({ factSummary: [{ text: `架空市のバス路線は${wrongNumber}本である`, groundFactIds: ["fx-1"] }] }));
          const fake = createFakeClient((_call, index) => (index === 0 ? JSON.stringify(passingCandidate()) : wrong));
          const { deps } = createTestDeps(root, fake.client);
          const saved = await runDraft(deps, candidateRequest({ topic: "保存済み" }));
          expect(saved.ok).toBe(true);
          const before = await readAiContribution(deps.store);
          const draftsBefore = await filesIn(join(root.rootDir, "drafts", "ISSUE_CANDIDATE"));

          fc.pre(topic !== "保存済み");
          const refused = await runDraft(deps, candidateRequest({ topic }));
          expect(refused.ok === false && refused.error.code).toBe("CHECK_FAILED");

          const after = await readAiContribution(deps.store);
          expect(before.ok && after.ok).toBe(true);
          if (before.ok && after.ok) {
            expect(after.value.drafted).toBe(before.value.drafted + 1);
            expect(after.value.rejectedByChecks).toBe(before.value.rejectedByChecks + 1);
            expect(after.value.humanEdited).toBe(before.value.humanEdited);
            expect(after.value.humanRejected).toBe(before.value.humanRejected);
          }
          expect(await filesIn(join(root.rootDir, "drafts", "ISSUE_CANDIDATE"))).toEqual(draftsBefore);
        });
      }),
      { numRuns: RUNS },
    );
  });
});
