import { AnswersSchema, type Answers, type ValuesMap } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { TEST_NEUTRALITY_CONFIG } from "../../../../../tests/harness/regional-values/bankInjection.js";
import { FIXTURE_QUICK_THEMES } from "../../../../../tests/harness/regional-values/contentFixtures.js";
import { loadFixtureBundle } from "../../../../../tests/harness/regional-values/loadFixtureBundle.js";
import { mapOf } from "../../../../../tests/harness/regional-values/viewDriver.js";
import { containsAny, lengthOf, sentencesOf } from "../bank/textMetrics.js";
import { buildResultViewModel } from "../view/buildResultViewModel.js";
import { inspectFixedTexts, inspectGuidance, inspectResultTexts, matchesTradeoffForm } from "./inspectFixedTexts.js";

// Feature: regional-values-map, Property 50: the source of the wording and the banned words

/** Fixed seed: a green run repeats and a failure can be replayed. */
const PARAMETERS = { seed: 350_050, numRuns: 120 };

const CONFIG = TEST_NEUTRALITY_CONFIG;
const BUNDLE = loadFixtureBundle();
const QUICK = BUNDLE.diagnosticSets.find((set) => set.setKind === "QUICK");

if (QUICK === undefined) {
  throw new Error("The fixture bundle has a QUICK set");
}

const NOTICE = BUNDLE.fixedTexts.items.find((item) => item.key === "notice")?.text ?? "";

const IMPORTANCE_CODES = ["VERY_IMPORTANT", "IMPORTANT", "NEUTRAL", "NOT_VERY_IMPORTANT", "NOT_IMPORTANT"] as const;
const TRADEOFF_CODES = ["A_STRONG", "A_LEAN", "BALANCED", "B_LEAN", "B_STRONG"] as const;

/** An answer to each question of the QUICK set: an opinion, "わからない", "回答しない" or none. */
const answersArbitrary: fc.Arbitrary<Answers> = fc
  .tuple(
    ...QUICK.questionIds.map((questionId) => {
      const question = BUNDLE.questions.find((candidate) => candidate.questionId === questionId);
      const opinions = question?.kind === "TRADEOFF" ? TRADEOFF_CODES : IMPORTANCE_CODES;
      return fc.constantFrom(...opinions, "UNSURE", "DECLINE", undefined).map((code) => [questionId, code] as const);
    }),
  )
  .map((pairs) => AnswersSchema.parse(Object.fromEntries(pairs.filter(([, code]) => code !== undefined))));

// ---------------------------------------------------------------------------
// The wording that a bundle can show
// ---------------------------------------------------------------------------

const PLACEHOLDER = /\{[A-Za-z][A-Za-z0-9]*\}/gu;

function escapePattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** A fixed text as a pattern, in which each placeholder stands for any filled-in value. */
function templatePattern(text: string): RegExp {
  const parts = text.split(PLACEHOLDER).map(escapePattern);
  return new RegExp(`^${parts.join(".+?")}$`, "u");
}

const FIXED_PATTERNS = BUNDLE.fixedTexts.items.map((item) => templatePattern(item.text));

/**
 * The wording that is not a fixed text: result texts, guidance, theme names, the questions with
 * their explanations and labels (Req 5.4 shows the explanations of a theme), and the titles of the
 * issue cards that the screen links to.
 */
const OTHER_WORDING = new Set<string>([
  ...BUNDLE.resultTexts.map((item) => item.text),
  ...BUNDLE.guidance.map((item) => item.text),
  ...BUNDLE.themes.map((theme) => theme.label),
  ...BUNDLE.cards.map((card) => card.title),
  ...BUNDLE.questions.flatMap((question) => [
    question.text,
    question.explanation,
    question.unsureLabel,
    question.declineLabel,
    ...(question.kind === "PRIORITY_PICK" ? [] : question.opinionLabels),
  ]),
]);

function isApprovedWording(text: string): boolean {
  return OTHER_WORDING.has(text) || FIXED_PATTERNS.some((pattern) => pattern.test(text));
}

interface RichPart {
  t: "text" | "term";
  v: string;
}

function isRichPart(value: unknown): value is RichPart {
  return (
    value !== null &&
    typeof value === "object" &&
    "t" in value &&
    (value.t === "text" || value.t === "term") &&
    "v" in value &&
    typeof value.v === "string"
  );
}

/**
 * Every sentence-like string of a view model. A noted text is joined to the text it was made of;
 * the description of a term belongs to the issue card and is left out.
 */
function shownTexts(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    if (value.length > 0 && value.every(isRichPart)) {
      out.push(value.map((part) => part.v).join(""));
    } else {
      for (const child of value) {
        shownTexts(child, out);
      }
    }
  } else if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      shownTexts(child, out);
    }
  }
  return out;
}

/** Words and numbers such as "3 / 6" and IDs are not wording; only text with a Japanese character is. */
const HAS_NON_ASCII = /[^\u0000-\u007f]/u;

function viewOf(answers: Answers, previous: ValuesMap | null) {
  return buildResultViewModel({
    bundle: BUNDLE,
    setKind: "QUICK",
    answers,
    current: mapOf(BUNDLE, "QUICK", answers),
    previous,
    focusThemeId: null,
  });
}

function previousMapOf(answers: Answers): ValuesMap | null {
  const result = mapOf(BUNDLE, "QUICK", answers);
  return result.ok ? result.value : null;
}

const bannedWords = [...CONFIG.bannedWords, ...Object.values(CONFIG.wordCategories).flat()];

describe("the fictional bundle passes the checks of the wording", () => {
  it("has no finding in the fixed texts, the result texts and the guidance questions", () => {
    expect(inspectFixedTexts(BUNDLE.fixedTexts, CONFIG)).toEqual([]);
    expect(inspectResultTexts(BUNDLE.resultTexts, CONFIG, FIXTURE_QUICK_THEMES)).toEqual([]);
    expect(inspectGuidance(BUNDLE.guidance, CONFIG, FIXTURE_QUICK_THEMES)).toEqual([]);
  });
});

describe("the result view model of a bundle that passes the checks (Property 50)", () => {
  /** **Validates: Requirements 5.12, 6.8, 12.2** */
  it("is made of approved fixed texts, filled-in values, questions, labels and theme names only", () => {
    fc.assert(
      fc.property(answersArbitrary, answersArbitrary, (answers, earlier) => {
        const view = viewOf(answers, previousMapOf(earlier));
        const unknown = shownTexts(view).filter((text) => HAS_NON_ASCII.test(text) && !isApprovedWording(text));
        expect(unknown).toEqual([]);
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 5.12, 6.7, 12.2** */
  it("contains no banned word, except in the notice", () => {
    fc.assert(
      fc.property(answersArbitrary, answersArbitrary, (answers, earlier) => {
        const view = viewOf(answers, previousMapOf(earlier));
        const found = shownTexts(view).filter((text) => text !== NOTICE && containsAny(text, bannedWords));
        expect(found).toEqual([]);
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 5.10, 11.7** */
  it("has no sentence of more than 60 characters, and no sentence that tells what the user is", () => {
    const claims = CONFIG.userClaimPatterns.map((pattern) => new RegExp(pattern, "u"));
    fc.assert(
      fc.property(answersArbitrary, answersArbitrary, (answers, earlier) => {
        const view = viewOf(answers, previousMapOf(earlier));
        const texts = shownTexts(view).filter((text) => HAS_NON_ASCII.test(text) && !isQuestionOrLabel(text));
        expect(texts.filter((text) => sentencesOf(text).some((sentence) => lengthOf(sentence) > 60))).toEqual([]);
        expect(texts.filter((text) => claims.some((claim) => claim.test(text)))).toEqual([]);
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 5.3, 5.18** */
  it("states each trade-off result in the form, without a negation word or a word that makes light of a direction", () => {
    fc.assert(
      fc.property(answersArbitrary, answersArbitrary, (answers, earlier) => {
        const view = viewOf(answers, previousMapOf(earlier));
        if (view.kind !== "MAP") {
          return;
        }
        for (const item of view.tradeoff.items) {
          const text = item.text.map((part) => part.v).join("");
          expect([2, 1, 0, -1, -2].some((level) => matchesTradeoffForm(level as -2 | -1 | 0 | 1 | 2, text)), text).toBe(true);
          expect(containsAny(text, [...CONFIG.negationWords, ...CONFIG.disparagingWords]), text).toBe(false);
        }
      }),
      PARAMETERS,
    );
  });
});

/**
 * The wording of the questions, the labels, the theme names and the card titles belongs to the question
 * bank and the cards, which have their own checks (8.3 to 8.5, 8.7). The texts that this task checks
 * are the fixed texts, the result texts and the guidance questions.
 */
function isQuestionOrLabel(text: string): boolean {
  const checkedHere = BUNDLE.resultTexts.some((item) => item.text === text) || BUNDLE.guidance.some((item) => item.text === text);
  return OTHER_WORDING.has(text) && !checkedHere;
}

describe("the generated answers of Property 50", () => {
  it("reach a map, an error, every state and a previous result", () => {
    const samples = fc.sample(fc.tuple(answersArbitrary, answersArbitrary), { seed: 350_050, numRuns: 300 });
    const kinds = new Set<string>();
    let withDiff = 0;
    for (const [answers, earlier] of samples) {
      const view = viewOf(answers, previousMapOf(earlier));
      kinds.add(view.kind);
      if (view.kind === "MAP" && view.diff !== null) {
        withDiff += 1;
      }
    }
    expect([...kinds].sort()).toEqual(["ERROR", "MAP"]);
    expect(withDiff).toBeGreaterThanOrEqual(30);
  });
});
