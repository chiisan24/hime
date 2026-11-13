import { ISOInstantSchema } from "@ehime-vote-navigator/contracts";
import type { Question, QuestionBank } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";

import type { BalanceViolation } from "../../../packages/domain/src/regional-values/bank/balanceChecks.js";
import { PASSING_IMPORTANCE_LABELS, PASSING_PICK_ID, approvalFor, buildPassingBank } from "./bankInjection.js";

/**
 * Test harness for the balance, composition and approval checks (8.4, reused by 8.5).
 *
 * Each builder makes a bank from a plain description, and each expected result is computed
 * from that description alone, never by calling the checks under test. The labels, limits
 * and counts are written out here and not imported from the code under test.
 */

type ImportanceQuestion = Extract<Question, { kind: "IMPORTANCE" }>;
type TradeoffQuestion = Extract<Question, { kind: "TRADEOFF" }>;
type ThemeId = ImportanceQuestion["themeId"];
type Category = TradeoffQuestion["directionA"]["category"];
type SetKind = QuestionBank["diagnosticSets"][number]["setKind"];

export const ALL_THEMES: readonly ThemeId[] = [
  "TRANSPORT",
  "EDUCATION_CHILDCARE",
  "ECONOMY_EMPLOYMENT",
  "HEALTHCARE_WELFARE",
  "DISASTER_PREVENTION",
  "POPULATION_REVITALIZATION",
];

/** The fixed wording of the importance labels (Req 3.6), in answer-value order. */
export const FIXED_IMPORTANCE_LABELS: readonly string[] = [...PASSING_IMPORTANCE_LABELS];

/** The code points of a trimmed string: the unit of every length rule. */
export function codePoints(value: string): number {
  return Array.from(value.trim()).length;
}

function passingImportance(): ImportanceQuestion {
  const found = buildPassingBank().questions.find((question) => question.kind === "IMPORTANCE");
  if (found?.kind !== "IMPORTANCE") {
    throw new Error("The passing bank has an importance question");
  }
  return found;
}

function passingTradeoff(): TradeoffQuestion {
  const found = buildPassingBank().questions.find((question) => question.kind === "TRADEOFF");
  if (found?.kind !== "TRADEOFF") {
    throw new Error("The passing bank has a trade-off question");
  }
  return found;
}

function passingPick(): Extract<Question, { kind: "PRIORITY_PICK" }> {
  const found = buildPassingBank().questions.find((question) => question.kind === "PRIORITY_PICK");
  if (found?.kind !== "PRIORITY_PICK") {
    throw new Error("The passing bank has a priority pick question");
  }
  return found;
}

// ---------------------------------------------------------------------------
// A single question
// ---------------------------------------------------------------------------

/** A bank with one importance question and one set that lists it. */
export function bankWithImportanceLabels(labels: ImportanceQuestion["opinionLabels"]): QuestionBank {
  const bank = buildPassingBank();
  const question: ImportanceQuestion = { ...passingImportance(), opinionLabels: labels };
  return {
    ...bank,
    questions: [question],
    diagnosticSets: [{ setKind: "QUICK", themeIds: [question.themeId], questionIds: [question.questionId] }],
  };
}

/** A bank with one trade-off question whose directions have exactly the stated numbers of characters. */
export function bankWithDirectionLengths(lengthA: number, lengthB: number): QuestionBank {
  const bank = buildPassingBank();
  const base = passingTradeoff();
  const question: TradeoffQuestion = {
    ...base,
    directionA: { ...base.directionA, text: "あ".repeat(lengthA) },
    directionB: { ...base.directionB, text: "い".repeat(lengthB) },
  };
  return {
    ...bank,
    questions: [question],
    diagnosticSets: [{ setKind: "QUICK", themeIds: [question.themeId], questionIds: [question.questionId] }],
  };
}

/** The fixed labels with each label replaced by a string of the stated number of characters, or kept. */
export function labelsOfLengths(lengths: readonly (number | null)[]): ImportanceQuestion["opinionLabels"] {
  const pick = (index: number): string => {
    const length = lengths[index];
    const fixed = FIXED_IMPORTANCE_LABELS[index];
    if (fixed === undefined) {
      throw new Error("Unknown label index");
    }
    return length === null || length === undefined ? fixed : "あ".repeat(length);
  };
  return [pick(0), pick(1), pick(2), pick(3), pick(4)];
}

// ---------------------------------------------------------------------------
// Swapped trade-off questions and the direction of direction A in one set
// ---------------------------------------------------------------------------

export type TradeoffSpec = Readonly<{ swapDirections: boolean; directionA: Category }>;

export type SwapAndDirectionSpec = Readonly<{
  /** The trade-off questions that the set lists. */
  inSet: readonly TradeoffSpec[];
  /** Trade-off questions of the bank that the set does not list. They must not be counted. */
  outsideSet: readonly TradeoffSpec[];
}>;

function tradeoffFrom(spec: TradeoffSpec, questionId: string): TradeoffQuestion {
  const base = passingTradeoff();
  return {
    ...base,
    questionId,
    swapDirections: spec.swapDirections,
    directionA: { ...base.directionA, category: spec.directionA },
  };
}

/** A bank whose single set lists the `inSet` trade-off questions and one importance question. */
export function bankFromSwapAndDirection(spec: SwapAndDirectionSpec): QuestionBank {
  const bank = buildPassingBank();
  const importance = passingImportance();
  const listed = spec.inSet.map((item, index) => tradeoffFrom(item, `listed-${index}`));
  const outside = spec.outsideSet.map((item, index) => tradeoffFrom(item, `outside-${index}`));
  return {
    ...bank,
    questions: [importance, ...listed, ...outside],
    diagnosticSets: [
      {
        setKind: "QUICK",
        themeIds: [importance.themeId],
        questionIds: [importance.questionId, ...listed.map((question) => question.questionId)],
      },
    ],
  };
}

/** Expected SWAP_BALANCE: the numbers of swapped and not swapped questions differ by more than 1. */
export function expectedSwapViolation(spec: SwapAndDirectionSpec): boolean {
  const swapped = spec.inSet.filter((item) => item.swapDirections).length;
  const kept = spec.inSet.length - swapped;
  return Math.abs(swapped - kept) > 1;
}

/** Expected DIRECTION_BALANCE: the numbers of CHANGE and CONTINUE in direction A differ by more than 1. */
export function expectedDirectionViolation(spec: SwapAndDirectionSpec): boolean {
  const change = spec.inSet.filter((item) => item.directionA === "CHANGE").length;
  const keep = spec.inSet.filter((item) => item.directionA === "CONTINUE").length;
  return Math.abs(change - keep) > 1;
}

const tradeoffSpecArbitrary: fc.Arbitrary<TradeoffSpec> = fc.record({
  swapDirections: fc.boolean(),
  directionA: fc.constantFrom<Category>("CHANGE", "CONTINUE", "NEUTRAL"),
});

export const swapAndDirectionArbitrary: fc.Arbitrary<SwapAndDirectionSpec> = fc.record({
  inSet: fc.array(tradeoffSpecArbitrary, { maxLength: 9 }),
  outsideSet: fc.array(tradeoffSpecArbitrary, { maxLength: 4 }),
});

// ---------------------------------------------------------------------------
// The composition of a diagnostic set
// ---------------------------------------------------------------------------

/** A description of the set, from which the bank and the expected judgment are both made. */
export type SetSpec = Readonly<{
  setKind: SetKind;
  /** The themes that the set declares. QUICK declares three, chosen here by data. */
  declaredThemes: readonly ThemeId[];
  /** The numbers of importance and trade-off questions that the set lists for each theme. */
  importance: Readonly<Record<ThemeId, number>>;
  tradeoff: Readonly<Record<ThemeId, number>>;
  /** The number of priority pick questions that the set lists. */
  picks: number;
  /** The position of one listed question that has weight 2, or null for none. */
  heavyAt: number | null;
  /** The first listed question is listed twice. */
  duplicateFirst: boolean;
  /** An ID that is not a question of the bank is listed. */
  unknownQuestion: boolean;
}>;

function zeroCounts(): Record<ThemeId, number> {
  return {
    TRANSPORT: 0,
    EDUCATION_CHILDCARE: 0,
    ECONOMY_EMPLOYMENT: 0,
    HEALTHCARE_WELFARE: 0,
    DISASTER_PREVENTION: 0,
    POPULATION_REVITALIZATION: 0,
  };
}

/** The set that satisfies the composition rule of its kind, with the stated themes. */
export function validSetSpec(setKind: SetKind, themes: readonly ThemeId[]): SetSpec {
  const importance = zeroCounts();
  const tradeoff = zeroCounts();
  for (const theme of themes) {
    importance[theme] = 1;
    tradeoff[theme] = 1;
  }
  return {
    setKind,
    declaredThemes: themes,
    importance,
    tradeoff,
    picks: setKind === "FULL" ? 1 : 0,
    heavyAt: null,
    duplicateFirst: false,
    unknownQuestion: false,
  };
}

function listedCount(spec: SetSpec): number {
  return ALL_THEMES.reduce((sum, theme) => sum + spec.importance[theme] + spec.tradeoff[theme], spec.picks);
}

/**
 * Expected SET_COMPOSITION violation (Req 3.2): QUICK declares three different themes and FULL
 * the six; each declared theme has one importance and one trade-off question and an undeclared
 * theme has none; a priority pick is absent from QUICK and exactly one in FULL; every weight is
 * 1; every listed ID is a different question of the bank.
 */
export function expectedCompositionViolation(spec: SetSpec): boolean {
  const wanted = spec.setKind === "QUICK" ? 3 : 6;
  const declared = new Set(spec.declaredThemes);
  const themesOk = declared.size === spec.declaredThemes.length && declared.size === wanted;
  const perThemeOk = ALL_THEMES.every((theme) =>
    declared.has(theme)
      ? spec.importance[theme] === 1 && spec.tradeoff[theme] === 1
      : spec.importance[theme] === 0 && spec.tradeoff[theme] === 0,
  );
  const picksOk = spec.picks === (spec.setKind === "FULL" ? 1 : 0);
  const total = listedCount(spec);
  const weightsOk = spec.heavyAt === null || spec.heavyAt >= total;
  const idsOk = !(spec.duplicateFirst && total >= 1) && !spec.unknownQuestion;
  return !(themesOk && perThemeOk && picksOk && weightsOk && idsOk);
}

/** A bank with the questions that the description lists, and its single set. */
export function bankFromSetSpec(spec: SetSpec): QuestionBank {
  const bank = buildPassingBank();
  const importance = passingImportance();
  const tradeoff = passingTradeoff();
  const pick = passingPick();
  const questions: Question[] = [];
  for (const theme of ALL_THEMES) {
    for (let index = 0; index < spec.importance[theme]; index += 1) {
      questions.push({ ...importance, questionId: `imp-${theme}-${index}`, themeId: theme });
    }
    for (let index = 0; index < spec.tradeoff[theme]; index += 1) {
      questions.push({ ...tradeoff, questionId: `tra-${theme}-${index}`, themeId: theme });
    }
  }
  for (let index = 0; index < spec.picks; index += 1) {
    questions.push({ ...pick, questionId: index === 0 ? PASSING_PICK_ID : `${PASSING_PICK_ID}-${index}` });
  }
  const weighted = questions.map((question, index) =>
    index === spec.heavyAt ? { ...question, weight: 2 } : question,
  );
  const ids = weighted.map((question) => question.questionId);
  const first = ids[0];
  return {
    ...bank,
    questions: weighted,
    diagnosticSets: [
      {
        setKind: spec.setKind,
        themeIds: [...spec.declaredThemes],
        questionIds: [
          ...ids,
          ...(spec.duplicateFirst && first !== undefined ? [first] : []),
          ...(spec.unknownQuestion ? ["not-a-question-of-the-bank"] : []),
        ],
      },
    ],
  };
}

const THEME_COUNT_BY_KIND: Readonly<Record<SetKind, number>> = { QUICK: 3, FULL: 6 };

/** A set that satisfies the rule, for any three themes in QUICK (the themes are data) and the six in FULL. */
export const validSetArbitrary: fc.Arbitrary<SetSpec> = fc
  .constantFrom<SetKind>("QUICK", "FULL")
  .chain((setKind) =>
    fc
      .shuffledSubarray([...ALL_THEMES], {
        minLength: THEME_COUNT_BY_KIND[setKind],
        maxLength: THEME_COUNT_BY_KIND[setKind],
      })
      .map((themes) => validSetSpec(setKind, themes)),
  );

type Mutation = (spec: SetSpec, a: number, b: number) => SetSpec;

function withCount(counts: Readonly<Record<ThemeId, number>>, theme: ThemeId, value: number): Record<ThemeId, number> {
  return { ...counts, [theme]: value };
}

function themeAt(a: number): ThemeId {
  return ALL_THEMES[a % ALL_THEMES.length] ?? "TRANSPORT";
}

const MUTATIONS: readonly Mutation[] = [
  (spec) => ({ ...spec, setKind: spec.setKind === "QUICK" ? "FULL" : "QUICK" }),
  (spec) => ({ ...spec, declaredThemes: spec.declaredThemes.slice(1) }),
  (spec, a) => ({
    ...spec,
    declaredThemes: spec.declaredThemes.includes(themeAt(a)) ? spec.declaredThemes : [...spec.declaredThemes, themeAt(a)],
  }),
  (spec) => {
    const first = spec.declaredThemes[0];
    return first === undefined ? spec : { ...spec, declaredThemes: [...spec.declaredThemes, first] };
  },
  (spec, a, b) => ({ ...spec, importance: withCount(spec.importance, themeAt(a), b % 3) }),
  (spec, a, b) => ({ ...spec, tradeoff: withCount(spec.tradeoff, themeAt(a), b % 3) }),
  (spec, a) => ({ ...spec, picks: a % 3 }),
  (spec, a) => ({ ...spec, heavyAt: a % 14 }),
  (spec) => ({ ...spec, duplicateFirst: true }),
  (spec) => ({ ...spec, unknownQuestion: true }),
];

/** A valid set with one or two changes, so that both accepted and rejected sets are common. */
export const changedSetArbitrary: fc.Arbitrary<SetSpec> = fc
  .tuple(
    validSetArbitrary,
    fc.array(fc.record({ which: fc.nat({ max: MUTATIONS.length - 1 }), a: fc.nat({ max: 99 }), b: fc.nat({ max: 99 }) }), {
      minLength: 1,
      maxLength: 2,
    }),
  )
  .map(([valid, changes]) =>
    changes.reduce((spec, { which, a, b }) => (MUTATIONS[which] ?? ((same: SetSpec) => same))(spec, a, b), valid),
  );

export const setSpecArbitrary: fc.Arbitrary<SetSpec> = fc.oneof(
  { weight: 3, arbitrary: validSetArbitrary },
  { weight: 7, arbitrary: changedSetArbitrary },
);

// ---------------------------------------------------------------------------
// Approval of one version of a question
// ---------------------------------------------------------------------------

/** One approval record, with its instants as epoch milliseconds so that the judgment needs no parsing. */
export type ApprovalSpec = Readonly<{
  version: number;
  approval: null | Readonly<{
    forVersion: number;
    reviewedMs: number;
    approvedMs: number;
    reviewedOffsetMinutes: number;
    approvedOffsetMinutes: number;
  }>;
}>;

/** Expected approval validity (Req 3.10): a record for this version, approved at or after the review. */
export function expectedApprovalValid(spec: ApprovalSpec): boolean {
  const { approval } = spec;
  return approval !== null && approval.forVersion === spec.version && approval.approvedMs >= approval.reviewedMs;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** An ISO 8601 instant with a numeric offset and milliseconds, for the stated epoch millisecond. */
export function formatInstant(epochMs: number, offsetMinutes: number): string {
  const local = new Date(epochMs + offsetMinutes * 60_000);
  const base = local.toISOString().slice(0, 23);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  return `${base}${sign}${twoDigits(Math.floor(absolute / 60))}:${twoDigits(absolute % 60)}`;
}

/** The first importance question of a bank with the stated version and approval. */
export function bankWithApproval(spec: ApprovalSpec): QuestionBank {
  const bank = buildPassingBank();
  const base = passingImportance();
  const { approval } = spec;
  const question: ImportanceQuestion = {
    ...base,
    version: spec.version,
    approval:
      approval === null
        ? null
        : {
            ...approvalFor(approval.forVersion),
            forVersion: approval.forVersion,
            review: {
              ...approvalFor(approval.forVersion).review,
              reviewedAt: ISOInstantSchema.parse(formatInstant(approval.reviewedMs, approval.reviewedOffsetMinutes)),
            },
            approvedAt: ISOInstantSchema.parse(formatInstant(approval.approvedMs, approval.approvedOffsetMinutes)),
          },
  };
  return {
    ...bank,
    questions: [question],
    diagnosticSets: [{ setKind: "QUICK", themeIds: [question.themeId], questionIds: [question.questionId] }],
  };
}

const BASE_MS = Date.UTC(2026, 0, 2, 9, 0, 0);

/** The distance of the approval from the review: right around the boundary, or anywhere within about an hour. */
const approvalDeltaArbitrary: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(-60_000, -1, 0, 1, 60_000),
  fc.integer({ min: -5_000_000, max: 5_000_000 }),
);

export const approvalSpecArbitrary: fc.Arbitrary<ApprovalSpec> = fc.record({
  version: fc.integer({ min: 1, max: 4 }),
  approval: fc.oneof(
    { weight: 1, arbitrary: fc.constant(null) },
    {
      weight: 6,
      arbitrary: fc
        .record({
          forVersion: fc.integer({ min: 1, max: 4 }),
          reviewedMs: fc.integer({ min: 0, max: 5_000_000 }).map((offset) => BASE_MS + offset),
          delta: approvalDeltaArbitrary,
          reviewedOffsetMinutes: fc.constantFrom(0, 540, -300, 330),
          approvedOffsetMinutes: fc.constantFrom(0, 540, -300, 330),
        })
        .map(({ delta, reviewedMs, ...rest }) => ({ ...rest, reviewedMs, approvedMs: reviewedMs + delta })),
    },
  ),
});

/** An approval whose approval time is the review time or a stated number of milliseconds from it. */
export function approvalAround(version: number, deltaMs: number, offsets: readonly [number, number] = [0, 0]): ApprovalSpec {
  return {
    version,
    approval: {
      forVersion: version,
      reviewedMs: BASE_MS,
      approvedMs: BASE_MS + deltaMs,
      reviewedOffsetMinutes: offsets[0],
      approvedOffsetMinutes: offsets[1],
    },
  };
}

// ---------------------------------------------------------------------------
// One violation injected into the passing bank (reused by 8.5)
// ---------------------------------------------------------------------------

export type BalanceInjectionCase = Readonly<{
  name: string;
  /** Changes the passing bank so that exactly the violations of `expected` arise. */
  apply: (bank: QuestionBank) => QuestionBank;
  expected: readonly BalanceViolation[];
}>;

function replaceQuestion(bank: QuestionBank, questionId: string, update: (question: Question) => Question): QuestionBank {
  return {
    ...bank,
    questions: bank.questions.map((question) => (question.questionId === questionId ? update(question) : question)),
  };
}

function isTradeoff(question: Question): question is TradeoffQuestion {
  return question.kind === "TRADEOFF";
}

/**
 * Questions of the passing bank that the cases change. The TRANSPORT questions are in FULL
 * only; the EDUCATION questions are in QUICK and FULL.
 */
export const FULL_ONLY_IMPORTANCE_ID = "test-transport-importance-v1";
export const FULL_ONLY_TRADEOFF_ID = "test-transport-tradeoff-v1";
export const QUICK_TRADEOFF_ID = "test-education-tradeoff-v1";

export const BALANCE_INJECTION_CASES: readonly BalanceInjectionCase[] = [
  {
    name: "an importance label other than the fixed wording",
    apply: (bank) =>
      replaceQuestion(bank, FULL_ONLY_IMPORTANCE_ID, (question) =>
        question.kind === "IMPORTANCE"
          ? { ...question, opinionLabels: ["とても大切", "大切", "どちらでもない", "あまり大切でない", "大切でない"] }
          : question,
      ),
    expected: [{ check: "LABEL_SYMMETRY", questionId: FULL_ONLY_IMPORTANCE_ID }],
  },
  {
    name: "directions that differ by 21 characters",
    apply: (bank) =>
      replaceQuestion(bank, QUICK_TRADEOFF_ID, (question) =>
        isTradeoff(question)
          ? {
              ...question,
              directionA: { ...question.directionA, text: "あ".repeat(5) },
              directionB: { ...question.directionB, text: "い".repeat(26) },
            }
          : question,
      ),
    expected: [{ check: "DIRECTION_LENGTH", questionId: QUICK_TRADEOFF_ID }],
  },
  {
    name: "a swapped trade-off question that makes FULL uneven",
    apply: (bank) =>
      replaceQuestion(bank, FULL_ONLY_TRADEOFF_ID, (question) =>
        isTradeoff(question) ? { ...question, swapDirections: true } : question,
      ),
    expected: [{ check: "SWAP_BALANCE", setKind: "FULL" }],
  },
  {
    name: "a direction A that makes FULL uneven",
    apply: (bank) =>
      replaceQuestion(bank, FULL_ONLY_TRADEOFF_ID, (question) =>
        isTradeoff(question) ? { ...question, directionA: { ...question.directionA, category: "CONTINUE" } } : question,
      ),
    expected: [{ check: "DIRECTION_BALANCE", setKind: "FULL" }],
  },
  {
    name: "a question taken out of the QUICK set",
    apply: (bank) => ({
      ...bank,
      diagnosticSets: bank.diagnosticSets.map((set) =>
        set.setKind === "QUICK" ? { ...set, questionIds: set.questionIds.slice(1) } : set,
      ),
    }),
    expected: [{ check: "SET_COMPOSITION", setKind: "QUICK" }],
  },
  {
    name: "a weight other than 1 in a question of FULL only",
    apply: (bank) => replaceQuestion(bank, FULL_ONLY_IMPORTANCE_ID, (question) => ({ ...question, weight: 2 })),
    expected: [{ check: "SET_COMPOSITION", setKind: "FULL" }],
  },
  {
    name: "a question without an approval",
    apply: (bank) => replaceQuestion(bank, QUICK_TRADEOFF_ID, (question) => ({ ...question, approval: null })),
    expected: [{ check: "REVIEW_APPROVAL", questionId: QUICK_TRADEOFF_ID }],
  },
  {
    name: "a new version that keeps the approval of the earlier version",
    apply: (bank) =>
      replaceQuestion(bank, FULL_ONLY_TRADEOFF_ID, (question) => ({ ...question, version: question.version + 1 })),
    expected: [{ check: "REVIEW_APPROVAL", questionId: FULL_ONLY_TRADEOFF_ID }],
  },
];

const BALANCE_ORDER: readonly BalanceViolation["check"][] = [
  "LABEL_SYMMETRY",
  "DIRECTION_LENGTH",
  "SWAP_BALANCE",
  "DIRECTION_BALANCE",
  "SET_COMPOSITION",
  "REVIEW_APPROVAL",
];

/**
 * The violations that the cases must produce together, ordered by check definition and then by
 * bank definition (questions in bank order, sets in bank order). Computed from the cases alone.
 * The cases must change different questions and sets.
 */
export function expectedBalanceViolations(
  bank: QuestionBank,
  cases: readonly BalanceInjectionCase[],
): BalanceViolation[] {
  const position = (violation: BalanceViolation): number =>
    "setKind" in violation
      ? bank.diagnosticSets.findIndex((set) => set.setKind === violation.setKind)
      : bank.questions.findIndex((question) => question.questionId === violation.questionId);
  return cases
    .flatMap((injectionCase) => injectionCase.expected)
    .sort(
      (left, right) =>
        BALANCE_ORDER.indexOf(left.check) - BALANCE_ORDER.indexOf(right.check) || position(left) - position(right),
    );
}

// ---------------------------------------------------------------------------
// Relabelling the themes (a bank that is the same except for the theme IDs)
// ---------------------------------------------------------------------------

/** A permutation of the six themes, as the theme that each theme becomes. */
export type ThemePermutation = Readonly<Record<ThemeId, ThemeId>>;

export const themePermutationArbitrary: fc.Arbitrary<ThemePermutation> = fc
  .shuffledSubarray([...ALL_THEMES], { minLength: ALL_THEMES.length, maxLength: ALL_THEMES.length })
  .map((shuffled): ThemePermutation => {
    // The theme at position i of the definition order becomes the theme at position i of the shuffled order.
    const becomes = (index: number, same: ThemeId): ThemeId => shuffled[index] ?? same;
    return {
      TRANSPORT: becomes(0, "TRANSPORT"),
      EDUCATION_CHILDCARE: becomes(1, "EDUCATION_CHILDCARE"),
      ECONOMY_EMPLOYMENT: becomes(2, "ECONOMY_EMPLOYMENT"),
      HEALTHCARE_WELFARE: becomes(3, "HEALTHCARE_WELFARE"),
      DISASTER_PREVENTION: becomes(4, "DISASTER_PREVENTION"),
      POPULATION_REVITALIZATION: becomes(5, "POPULATION_REVITALIZATION"),
    };
  });

/**
 * The same bank with every theme ID replaced by the theme that the permutation names, in the theme
 * definitions, the questions and the sets. The text, the label and every other value stay with
 * their question, so the wording of an importance question still names its own theme.
 */
export function relabelThemes(bank: QuestionBank, permutation: ThemePermutation): QuestionBank {
  return {
    ...bank,
    themes: bank.themes.map((theme) => ({ ...theme, themeId: permutation[theme.themeId] })),
    questions: bank.questions.map((question) =>
      question.kind === "PRIORITY_PICK"
        ? { ...question, themeIds: question.themeIds.map((theme) => permutation[theme]) }
        : { ...question, themeId: permutation[question.themeId] },
    ),
    diagnosticSets: bank.diagnosticSets.map((set) => ({ ...set, themeIds: set.themeIds.map((theme) => permutation[theme]) })),
  };
}

/** The same bank with the stated data kind and, for each question, the stated author. */
export function withAttributes(
  bank: QuestionBank,
  dataKind: QuestionBank["dataKind"],
  authors: readonly Question["author"][],
): QuestionBank {
  return {
    ...bank,
    dataKind,
    questions: bank.questions.map((question, index) => ({
      ...question,
      dataKind,
      author: authors[index % Math.max(authors.length, 1)] ?? question.author,
    })),
  };
}
