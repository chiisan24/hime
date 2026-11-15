import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { candidateRequest, questionRequest, summaryRequest } from "../../../../../../tests/harness/regional-values/draftSupport.js";
import { buildPrompt } from "./index.js";
import type { PromptOptions } from "./index.js";

const RUNS = 200;

/** A word of a list, empty or not, with any characters (a list of the settings is text that a person writes). */
const wordArbitrary = fc.string({ minLength: 0, maxLength: 12 });
const listArbitrary = fc.array(wordArbitrary, { minLength: 0, maxLength: 8 });

const optionsArbitrary: fc.Arbitrary<PromptOptions> = fc.record({
  premiseTemplates: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 3 }),
  hedgeEndings: listArbitrary,
  causalWords: listArbitrary,
});

describe("Property: the lists of the settings in the instruction of an issue candidate", () => {
  it("puts every word of both lists in the instruction in brackets, and builds the same text from the same options", () => {
    fc.assert(
      fc.property(optionsArbitrary, (options) => {
        const first = buildPrompt(candidateRequest(), options);
        const again = buildPrompt(candidateRequest(), options);
        expect(again).toEqual(first);
        for (const word of [...options.hedgeEndings, ...options.causalWords]) {
          if (word !== "") {
            expect(first.system).toContain(`「${word}」`);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("leaves out the empty words: a list of empty words is the same as a list with no word", () => {
    fc.assert(
      fc.property(optionsArbitrary, fc.integer({ min: 0, max: 4 }), (options, empties) => {
        const padded = (words: readonly string[]): readonly string[] => [...words.filter((word) => word !== ""), ...Array.from({ length: empties }, () => "")];
        const withEmpties = buildPrompt(candidateRequest(), {
          ...options,
          hedgeEndings: padded(options.hedgeEndings),
          causalWords: padded(options.causalWords),
        });
        const without = buildPrompt(candidateRequest(), {
          ...options,
          hedgeEndings: options.hedgeEndings.filter((word) => word !== ""),
          causalWords: options.causalWords.filter((word) => word !== ""),
        });
        expect(withEmpties).toEqual(without);
        expect(without.system).not.toContain("「」");
      }),
      { numRuns: RUNS },
    );
  });

  it("does not let the lists reach the instruction of any other task", () => {
    const requests = [
      summaryRequest(),
      { ...summaryRequest(), task: "BACKGROUND_DRAFT" as const },
      { ...summaryRequest(), task: "TERM_GLOSS" as const },
      { ...summaryRequest(), task: "THEME_CLASSIFY" as const, themeId: "TRANSPORT" as const },
      questionRequest("IMPORTANCE"),
      questionRequest("TRADEOFF"),
      questionRequest("PRIORITY_PICK"),
    ];
    fc.assert(
      fc.property(optionsArbitrary, optionsArbitrary, (first, second) => {
        const common = { premiseTemplates: first.premiseTemplates };
        for (const request of requests) {
          expect(buildPrompt(request, { ...first, ...common })).toEqual(buildPrompt(request, { ...second, ...common }));
        }
      }),
      { numRuns: RUNS },
    );
  });
});
