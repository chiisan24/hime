import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { BedrockConverseClient, BedrockConverseResult, ConverseRequest } from "./bedrockConverse.js";
import { createLimitedConverseClient, worstCaseMicroUsd } from "./bedrockLimits.js";
import type { RefusalReason } from "./bedrockLimits.js";

const RUNS = 100;
const HAIKU = "jp.anthropic.claude-haiku-5-5";
const OPUS = "jp.anthropic.claude-opus-5-5";
const UNPRICED = "jp.anthropic.claude-unpriced-1";

const operationArbitrary = fc.record({
  modelId: fc.constantFrom(HAIKU, OPUS, UNPRICED),
  chars: fc.integer({ min: 6, max: 9_000 }),
  fails: fc.boolean(),
});

const limitsArbitrary = fc.record({
  maxCalls: fc.integer({ min: 0, max: 6 }),
  maxCostMicroUsd: fc.integer({ min: 0, max: 60_000 }),
  stopAfterFailure: fc.boolean(),
});

/** A request of exactly `chars` UTF-16 code units, with its place in the run written at the start of the text. */
function requestOf(modelId: string, chars: number, index: number): ConverseRequest {
  const marker = `${String(index).padStart(2, "0")}:`;
  return { modelId, system: "あ", text: `${marker}${"い".repeat(chars - 1 - marker.length)}` };
}

describe("a client with the limits of a run: properties", () => {
  /**
   * For any limits and any series of requests, the run never reaches the ceiling of its calls or of the cost, sends nothing after
   * a failure when it is told to stop, never sends a model that has no price, and refuses only when a limit really held.
   */
  it("holds the calls and the cost under their ceilings, stops after a failure, and refuses only for a reason that held", async () => {
    await fc.assert(
      fc.asyncProperty(limitsArbitrary, fc.array(operationArbitrary, { minLength: 1, maxLength: 12 }), async (limits, operations) => {
        const reached: number[] = [];
        const inner: BedrockConverseClient = {
          converse: (request) => {
            const index = Number(request.text.slice(0, 2));
            reached.push(index);
            const result: BedrockConverseResult = operations[index]?.fails === true ? { ok: false, error: { code: "TIMEOUT" } } : { ok: true, value: { text: "{}", status: 200, elapsedMs: 1 } };
            return Promise.resolve(result);
          },
        };
        const limited = createLimitedConverseClient(inner, limits);

        const results: BedrockConverseResult[] = [];
        for (const [index, operation] of operations.entries()) {
          results.push(await limited.client.converse(requestOf(operation.modelId, operation.chars, index)));
        }

        const worst = (index: number): number => worstCaseMicroUsd(operations[index]?.modelId ?? "", operations[index]?.chars ?? 0) ?? 0;

        // What was let through is within the ceilings.
        expect(reached.length).toBeLessThanOrEqual(limits.maxCalls);
        expect(reached.reduce((sum, index) => sum + worst(index), 0)).toBeLessThanOrEqual(limits.maxCostMicroUsd);
        expect(reached.every((index) => operations[index]?.modelId !== UNPRICED)).toBe(true);
        expect([...reached].sort((first, second) => first - second)).toEqual(reached);
        expect(limited.state().committedMicroUsd).toBe(reached.reduce((sum, index) => sum + worst(index), 0));

        // Nothing is let through after a failure when the run is told to stop.
        if (limits.stopAfterFailure) {
          const firstFailure = reached.find((index) => operations[index]?.fails === true);
          if (firstFailure !== undefined) {
            expect(reached.every((index) => index <= firstFailure)).toBe(true);
          }
        }

        // What was not let through never reached the service, and was answered as too many calls.
        const refused = operations.map((_, index) => index).filter((index) => !reached.includes(index));
        expect(limited.refusals()).toHaveLength(refused.length);
        expect(limited.records()).toHaveLength(reached.length);
        for (const index of refused) {
          expect(results[index]).toEqual({ ok: false, error: { code: "RATE_LIMITED" } });
        }

        // A refusal is for a reason that held at that moment: the run is not stopped sooner than it has to be.
        let admitted = 0;
        let committed = 0;
        let failed = false;
        const reasons: RefusalReason[] = [];
        for (const [index, operation] of operations.entries()) {
          const price = worstCaseMicroUsd(operation.modelId, operation.chars);
          const reason: RefusalReason | undefined =
            limits.stopAfterFailure && failed
              ? "STOPPED_AFTER_FAILURE"
              : admitted >= limits.maxCalls
                ? "CALL_LIMIT"
                : price === undefined
                  ? "PRICE_UNKNOWN"
                  : committed + price > limits.maxCostMicroUsd
                    ? "COST_LIMIT"
                    : undefined;
          if (reason !== undefined) {
            reasons.push(reason);
            expect(reached).not.toContain(index);
          } else {
            expect(reached).toContain(index);
            admitted += 1;
            committed += price ?? 0;
            failed = failed || operation.fails;
          }
        }
        expect(limited.refusals()).toEqual(reasons);
      }),
      { numRuns: RUNS },
    );
  });
});
