import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  createBedrockConverseClient,
  MAX_CONVERSE_INPUT_CHARS,
  type ConverseFetch,
} from "./bedrockConverse.js";

const RUNS = 100;

/** Text of an exact length above the cap, built from arbitrary characters. */
const overLengthTextArb = fc
  .tuple(
    fc.string({ unit: "binary", minLength: 1, maxLength: 40 }),
    fc.integer({ min: MAX_CONVERSE_INPUT_CHARS + 1, max: MAX_CONVERSE_INPUT_CHARS + 3_000 }),
  )
  .map(([unit, length]) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length));

describe("Bedrock Converse input cap", () => {
  /** **Validates: Requirements 14.7** */
  it("never lets text longer than 20000 characters reach fetch", async () => {
    await fc.assert(
      fc.asyncProperty(overLengthTextArb, async (text) => {
        let fetchCalls = 0;
        const countingFetch: ConverseFetch = () => {
          fetchCalls += 1;
          return Promise.reject(new Error("fetch must not be reached"));
        };
        const client = createBedrockConverseClient({
          environment: {
            AWS_BEARER_TOKEN_BEDROCK: "test-token",
            BEDROCK_GENERATION_MODEL_ID: "jp.anthropic.claude-haiku-5-5",
            BEDROCK_VERIFICATION_MODEL_ID: "jp.anthropic.claude-opus-5-5",
          },
          fetch: countingFetch,
          getToken: () => "test-token",
        });

        const result = await client.converse({
          modelId: "jp.anthropic.claude-haiku-5-5",
          system: "短く答えてください。",
          text,
        });

        expect(text.length).toBeGreaterThan(MAX_CONVERSE_INPUT_CHARS);
        expect(result.ok).toBe(false);
        expect(fetchCalls).toBe(0);
      }),
      { numRuns: RUNS },
    );
  });
});
