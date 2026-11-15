import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { checkFactSentence, computedFactSentence } from "./factSentence.js";
import { decimalText, surveyLabel } from "./surveyDate.js";

// Feature: regional-values-map, Property 26: 事実の数値
// **Validates: Requirements 7.20, 12.14**
//
// A fact item, its value that the method gives, and the sentence that the template makes from them. A
// sentence whose number is the value passes; a sentence whose number is changed to another value never
// does, and it is named `VALUE_NOT_WRITTEN`. The areas and the subjects have no digit, so that the
// number of the sentence is the number of the value and no other.

const PARAMETERS = { seed: 130_026, numRuns: 300 };

const AREAS = ["架空県", "あおば市", "みなと町", "ひなた村"] as const;
const SUBJECTS = ["避難所の数", "公園の面積", "図書館の蔵書数", "バス停の数"] as const;
const UNITS = ["件", "人", "か所", "%", "戸/世帯", "km2", "㎡"] as const;

const surveyDateArbitrary: fc.Arbitrary<string | number> = fc.oneof(
  fc.integer({ min: 1900, max: 2200 }),
  fc
    .tuple(fc.integer({ min: 1900, max: 2200 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
    .map(([year, month, day]) => `${String(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`),
);

const amountArbitrary = fc.oneof(
  fc.integer({ min: 0, max: 9_999_999 }),
  fc.integer({ min: 0, max: 99_999 }).map((hundredths) => hundredths / 100),
);

const caseArbitrary = fc.record({
  area: fc.constantFrom(...AREAS),
  subject: fc.constantFrom(...SUBJECTS),
  unit: fc.constantFrom(...UNITS),
  surveyDate: surveyDateArbitrary,
  amount: amountArbitrary,
});

function check(sentence: string, input: Readonly<{ area: string; unit: string; surveyDate: string | number; amount: number }>) {
  const value = { amount: input.amount, unit: input.unit };
  return checkFactSentence({ sentence, value, written: value, area: input.area, surveyDates: [input.surveyDate] });
}

/** Another value, always greater than the value, with at most two decimals like the values of the test. */
function otherAmount(amount: number, shift: number): number {
  return Math.round((amount + 1 + shift) * 100) / 100;
}

describe("checkFactSentence: Property 26", () => {
  it("accepts the sentence that the template makes from the value", () => {
    fc.assert(
      fc.property(caseArbitrary, (input) => {
        expect(check(computedFactSentence(input), input)).toEqual({ ok: true });
      }),
      PARAMETERS,
    );
  });

  it("refuses the sentence whose number was changed to another value, and names that the value is not written", () => {
    fc.assert(
      fc.property(caseArbitrary, fc.nat({ max: 9_999 }), (input, shift) => {
        const changed = otherAmount(input.amount, shift);
        const sentence = computedFactSentence({ ...input, amount: changed });
        const result = check(sentence, input);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.violations).toContain("VALUE_NOT_WRITTEN");
        }
      }),
      PARAMETERS,
    );
  });

  it("refuses the sentence of the value with the number of the value replaced in the text, whichever number is put there", () => {
    fc.assert(
      fc.property(caseArbitrary, fc.integer({ min: 0, max: 9_999_999 }), (input, other) => {
        fc.pre(other !== input.amount);
        const sentence = computedFactSentence(input);
        const written = `${decimalText(input.amount)}${input.unit}`;
        // The number is replaced where it is written, in the finished sentence.
        const changed = sentence.replace(written, `${String(other)}${input.unit}`);
        fc.pre(changed !== sentence);
        const result = check(changed, input);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.violations).toContain("VALUE_NOT_WRITTEN");
        }
      }),
      PARAMETERS,
    );
  });

  it("refuses the sentence whose date was changed, and names that the date is not grounded", () => {
    fc.assert(
      fc.property(
        caseArbitrary.filter((input) => typeof input.surveyDate === "string"),
        fc.integer({ min: 1, max: 28 }),
        (input, day) => {
          const date = String(input.surveyDate);
          const [year = "", month = "", originalDay = ""] = date.split("-");
          fc.pre(Number(originalDay) !== day);
          const sentence = computedFactSentence(input);
          const changed = sentence.replace(surveyLabel(date), `${Number(year)}年${Number(month)}月${day}日`);
          expect(changed).not.toBe(sentence);
          const result = check(changed, input);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.violations).toContain("DATE_NOT_GROUNDED");
          }
        },
      ),
      PARAMETERS,
    );
  });

  it("refuses a number that is added to the sentence of the value", () => {
    fc.assert(
      fc.property(caseArbitrary, fc.integer({ min: 100_000_000, max: 999_999_999 }), (input, added) => {
        const sentence = computedFactSentence(input).replace("です。", `で、前年より${String(added)}件多いです。`);
        const result = check(sentence, input);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.violations).toContain("NUMBER_NOT_GROUNDED");
        }
      }),
      PARAMETERS,
    );
  });

  it("gives the same result for the same input", () => {
    fc.assert(
      fc.property(caseArbitrary, (input) => {
        const sentence = computedFactSentence(input);
        expect(check(sentence, input)).toEqual(check(sentence, input));
      }),
      PARAMETERS,
    );
  });
});
