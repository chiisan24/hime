import type { GuidanceQuestion, IssueCard, Question, ResultText } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fullAssemblyInput, TEST_IDENTITY } from "../../../../../tests/harness/regional-values/bundleInput.js";
import { hasCurrentApproval } from "../bank/balanceChecks.js";
import { assembleBundleBody, type AssemblyInput } from "./assembleBundleBody.js";
import { finalizeBundle } from "./finalizeBundle.js";
import { portableCanonicalJson } from "./portableCanonicalJson.js";
import { verifyBundleText } from "./verifyBundleText.js";

// Feature: regional-values-map, Property 35: the invariants of the bundle

/** Fixed seed: a green run repeats and a failure can be replayed. */
const PARAMETERS = { seed: 350_035, numRuns: 150 };

const EXPECTED = { schemaVersion: 1, dataVersion: TEST_IDENTITY.dataVersion, buildKind: TEST_IDENTITY.buildKind } as const;

const QUICK_THEMES = new Set(["EDUCATION_CHILDCARE", "DISASTER_PREVENTION", "POPULATION_REVITALIZATION"]);
const PENDING = { status: "PENDING" } as const;

/**
 * One change to the complete input, and what it must do. The outcome is told by what the change
 * touches (a record of QUICK, of FULL only, or the identity), not by calling the code under test.
 */
type Target =
  | "NOTHING"
  | "QUICK_QUESTION"
  | "FULL_ONLY_QUESTION"
  | "QUICK_CARD"
  | "FULL_ONLY_CARD"
  | "QUICK_RESULT"
  | "FULL_ONLY_RESULT"
  | "QUICK_GUIDANCE"
  | "FULL_ONLY_GUIDANCE"
  | "FIXED_TEXT"
  | "FULL_BROKEN"
  | "FULL_UNDEFINED"
  | "QUICK_UNDEFINED"
  | "MIXED_KIND";

type Outcome = "FULL_KEPT" | "FULL_LEFT_OUT" | "REFUSED";

const OUTCOME: Readonly<Record<Target, Outcome>> = {
  NOTHING: "FULL_KEPT",
  QUICK_QUESTION: "REFUSED",
  FULL_ONLY_QUESTION: "FULL_LEFT_OUT",
  QUICK_CARD: "REFUSED",
  FULL_ONLY_CARD: "FULL_LEFT_OUT",
  QUICK_RESULT: "REFUSED",
  FULL_ONLY_RESULT: "FULL_LEFT_OUT",
  QUICK_GUIDANCE: "REFUSED",
  FULL_ONLY_GUIDANCE: "FULL_LEFT_OUT",
  FIXED_TEXT: "REFUSED",
  FULL_BROKEN: "REFUSED",
  FULL_UNDEFINED: "FULL_LEFT_OUT",
  QUICK_UNDEFINED: "REFUSED",
  MIXED_KIND: "REFUSED",
};

const TARGETS = Object.keys(OUTCOME) as Target[];

const changeArbitrary = fc.record({ target: fc.constantFrom(...TARGETS), pick: fc.nat({ max: 999 }) });

function nth<T>(items: readonly T[], pick: number): T {
  const item = items[pick % items.length];
  if (item === undefined) {
    throw new Error("There is nothing to change");
  }
  return item;
}

function mapQuestions(input: AssemblyInput, update: (question: Question, index: number) => Question): AssemblyInput {
  return { ...input, bank: { ...input.bank, questions: input.bank.questions.map(update) } };
}

function mapSets(input: AssemblyInput, update: (set: AssemblyInput["bank"]["diagnosticSets"][number]) => AssemblyInput["bank"]["diagnosticSets"][number] | undefined): AssemblyInput {
  const sets = input.bank.diagnosticSets.flatMap((set) => {
    const changed = update(set);
    return changed === undefined ? [] : [changed];
  });
  return { ...input, bank: { ...input.bank, diagnosticSets: sets } };
}

const quickIds = (input: AssemblyInput): Set<string> =>
  new Set(input.bank.diagnosticSets.find((set) => set.setKind === "QUICK")?.questionIds ?? []);

function applyChange(input: AssemblyInput, target: Target, pick: number): AssemblyInput {
  const inQuick = quickIds(input);
  switch (target) {
    case "NOTHING":
      return input;
    case "QUICK_QUESTION":
    case "FULL_ONLY_QUESTION": {
      const wantQuick = target === "QUICK_QUESTION";
      const candidates = input.bank.questions.filter((question) => inQuick.has(question.questionId) === wantQuick);
      const chosen = nth(candidates, pick);
      // Either no approval at all, or an approval of an earlier version.
      return mapQuestions(input, (question) =>
        question.questionId !== chosen.questionId
          ? question
          : pick % 2 === 0
            ? { ...question, approval: null }
            : { ...question, version: question.version + 1 },
      );
    }
    case "QUICK_CARD":
    case "FULL_ONLY_CARD": {
      const wantQuick = target === "QUICK_CARD";
      const chosen = nth(input.cards.filter((card) => QUICK_THEMES.has(card.themeId) === wantQuick), pick);
      return { ...input, cards: input.cards.map((card): IssueCard => (card.cardId === chosen.cardId ? { ...card, approval: PENDING } : card)) };
    }
    case "QUICK_RESULT":
    case "FULL_ONLY_RESULT": {
      const wantQuick = target === "QUICK_RESULT";
      const chosen = nth(input.resultTexts.filter((item) => QUICK_THEMES.has(item.themeId) === wantQuick), pick);
      return {
        ...input,
        resultTexts: input.resultTexts.map((item): ResultText => (item === chosen ? { ...item, approval: PENDING } : item)),
      };
    }
    case "QUICK_GUIDANCE":
    case "FULL_ONLY_GUIDANCE": {
      const wantQuick = target === "QUICK_GUIDANCE";
      const chosen = nth(input.guidance.filter((item) => QUICK_THEMES.has(item.themeId) === wantQuick), pick);
      return {
        ...input,
        guidance: input.guidance.map((item): GuidanceQuestion => (item === chosen ? { ...item, approval: PENDING } : item)),
      };
    }
    case "FIXED_TEXT": {
      const chosen = nth(input.fixedTexts.items, pick);
      return {
        ...input,
        fixedTexts: {
          ...input.fixedTexts,
          items: input.fixedTexts.items.map((item) => (item === chosen ? { ...item, approval: PENDING } : item)),
        },
      };
    }
    case "FULL_BROKEN":
      return mapSets(input, (set) => (set.setKind === "FULL" ? { ...set, questionIds: set.questionIds.slice(1 + (pick % 3)) } : set));
    case "FULL_UNDEFINED":
      return mapSets(input, (set) => (set.setKind === "FULL" ? undefined : set));
    case "QUICK_UNDEFINED":
      return mapSets(input, (set) => (set.setKind === "QUICK" ? undefined : set));
    case "MIXED_KIND": {
      // A question or a result text of the other data kind; the mixture is told by the records alone.
      if (pick % 2 === 0) {
        return mapQuestions(input, (question, index) =>
          index === pick % input.bank.questions.length ? { ...question, dataKind: "REAL_AI" } : question,
        );
      }
      const index = pick % input.resultTexts.length;
      return {
        ...input,
        resultTexts: input.resultTexts.map((item, position): ResultText =>
          position === index ? { ...item, dataKind: "REAL_AI" } : item,
        ),
      };
    }
  }
}

/** Up to two changes, so that the outcome of the worst of them decides. */
const changesArbitrary = fc.array(changeArbitrary, { minLength: 0, maxLength: 2 });

const RANK: Readonly<Record<Outcome, number>> = { FULL_KEPT: 0, FULL_LEFT_OUT: 1, REFUSED: 2 };

/**
 * The outcome of a list of changes. The worst outcome of the changes decides, except that a FULL
 * set that is not defined cannot be broken, and cannot lack a record: the changes that only concern
 * FULL have nothing to act on, and the FULL set is simply left out.
 */
function expectedOutcome(changes: readonly { target: Target }[]): Outcome {
  const fullIsGone = changes.some(({ target }) => target === "FULL_UNDEFINED");
  const concernsFullOnly = (target: Target): boolean => target === "FULL_BROKEN" || OUTCOME[target] === "FULL_LEFT_OUT";
  const effective = changes.filter(({ target }) => !(fullIsGone && concernsFullOnly(target) && target !== "FULL_UNDEFINED"));
  const worst = effective.reduce<Outcome>(
    (current, { target }) => (RANK[OUTCOME[target]] > RANK[current] ? OUTCOME[target] : current),
    "FULL_KEPT",
  );
  return fullIsGone && worst === "FULL_KEPT" ? "FULL_LEFT_OUT" : worst;
}

describe("assembleBundleBody: properties (Property 35)", () => {
  /** **Validates: Requirements 3.2, 3.10, 7.10, 7.15, 7.19, 12.14** */
  it("keeps, leaves FULL out, or refuses, as the records that were changed require", () => {
    fc.assert(
      fc.property(changesArbitrary, (changes) => {
        const input = changes.reduce((current, { target, pick }) => applyChange(current, target, pick), fullAssemblyInput());
        const result = assembleBundleBody(input);
        const outcome = expectedOutcome(changes);
        expect(result.ok).toBe(outcome !== "REFUSED");
        if (result.ok) {
          const kinds = result.value.body.diagnosticSets.map((set) => set.setKind);
          expect(kinds).toEqual(outcome === "FULL_KEPT" ? ["QUICK", "FULL"] : ["QUICK"]);
        }
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 3.10, 7.15, 7.19, 12.14** */
  it("publishes only approved records, of the data kind of the bundle, whose references all exist", () => {
    fc.assert(
      fc.property(changesArbitrary, (changes) => {
        const input = changes.reduce((current, { target, pick }) => applyChange(current, target, pick), fullAssemblyInput());
        const result = assembleBundleBody(input);
        if (!result.ok) {
          return;
        }
        const { body } = result.value;
        expect(body.questions.every((question) => hasCurrentApproval(question))).toBe(true);
        expect(body.cards.every((card) => card.approval.status === "APPROVED")).toBe(true);
        expect(body.resultTexts.every((item) => item.approval.status === "APPROVED")).toBe(true);
        expect(body.guidance.every((item) => item.approval.status === "APPROVED")).toBe(true);
        expect(body.fixedTexts.items.every((item) => item.approval.status === "APPROVED")).toBe(true);
        const kind = body.meta.dataKind;
        expect([...body.questions, ...body.cards, ...body.resultTexts].every((record) => record.dataKind === kind)).toBe(true);
        for (const set of body.diagnosticSets) {
          for (const themeId of set.themeIds) {
            expect(body.cards.some((card) => card.themeId === themeId)).toBe(true);
            expect(body.resultTexts.filter((item) => item.themeId === themeId)).toHaveLength(10);
            expect(body.guidance.filter((item) => item.themeId === themeId)).toHaveLength(3);
          }
          for (const questionId of set.questionIds) {
            expect(body.questions.some((question) => question.questionId === questionId)).toBe(true);
          }
        }
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 7.10, 10.7, 12.14** */
  it("makes a bundle that the browser verification accepts, whenever the assembly succeeds", async () => {
    await fc.assert(
      fc.asyncProperty(changesArbitrary, async (changes) => {
        const input = changes.reduce((current, { target, pick }) => applyChange(current, target, pick), fullAssemblyInput());
        const result = assembleBundleBody(input);
        if (!result.ok) {
          return;
        }
        const finalized = await finalizeBundle(result.value.body);
        expect(finalized.ok).toBe(true);
        if (finalized.ok) {
          const verified = await verifyBundleText(portableCanonicalJson(finalized.value), EXPECTED);
          expect(verified.ok).toBe(true);
        }
      }),
      { ...PARAMETERS, numRuns: 60 },
    );
  });

  /** **Validates: Requirements 12.14** */
  it("does not change the input, and gives the same body for the same input", () => {
    fc.assert(
      fc.property(changesArbitrary, (changes) => {
        const input = changes.reduce((current, { target, pick }) => applyChange(current, target, pick), fullAssemblyInput());
        const before = structuredClone(input);
        const first = assembleBundleBody(input);
        expect(input).toEqual(before);
        expect(assembleBundleBody(structuredClone(input))).toEqual(first);
      }),
      PARAMETERS,
    );
  });

  it("(sanity) the generated changes reach every outcome", () => {
    const samples = fc.sample(changesArbitrary, { seed: 350_035, numRuns: 400 });
    const counts = new Map<Outcome, number>();
    for (const changes of samples) {
      const outcome = expectedOutcome(changes);
      counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
    }
    for (const outcome of ["FULL_KEPT", "FULL_LEFT_OUT", "REFUSED"] as const) {
      expect(counts.get(outcome) ?? 0, outcome).toBeGreaterThanOrEqual(40);
    }
  });
});
