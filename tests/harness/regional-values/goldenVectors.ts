import type { MapError, MapInput, ValuesMap } from "@ehime-vote-navigator/contracts";

import {
  DP,
  EC,
  ED,
  HC,
  PICK_ID,
  PR,
  TB_FULL,
  TB_QUICK,
  TB_W,
  THEME_ORDER,
  TR,
  bankWithSet,
  importanceId,
  mapInput,
  tradeoffId,
  type MapBank,
  type ThemeValue,
} from "./testBanks.js";

/**
 * The golden vectors V01 to V18 of the design (Req 12.1): inputs and the expected
 * outputs, worked out by hand in the design document. The expected values are
 * fixed values and are never produced by the code under test. The thresholds are
 * 50 and 150 unless a vector says otherwise.
 */

export type GoldenOutcome =
  | { ok: true; value: ValuesMap }
  | { ok: false; error: MapError };

export type GoldenVector = Readonly<{
  id: string;
  title: string;
  input: MapInput;
  expected: GoldenOutcome;
}>;

type Axis = ValuesMap["themes"][number]["importance"];
type Level = -2 | -1 | 0 | 1 | 2;
type Reason = "UNSURE" | "DECLINE" | "UNANSWERED";

const det = (score: number, level: Level): Axis => ({ state: "DETERMINED", score, level });
const und = (...reasons: Reason[]): Axis => ({ state: "UNDETERMINED", reasons });
const NA: Axis = { state: "NOT_ASKED" };

/** The six themes in definition order; a theme that is not listed has no asked axis. */
function themesOf(...rows: readonly (readonly [ThemeValue, Axis, Axis])[]): ValuesMap["themes"] {
  return THEME_ORDER.map((themeId) => {
    const row = rows.find((candidate) => candidate[0] === themeId);
    return { themeId, importance: row?.[1] ?? NA, tradeoff: row?.[2] ?? NA };
  });
}

function groupsOf(
  plus2: ThemeValue[],
  plus1: ThemeValue[],
  zero: ThemeValue[],
  minus1: ThemeValue[],
  minus2: ThemeValue[],
): ValuesMap["importanceGroups"] {
  return [
    { level: 2, themeIds: plus2 },
    { level: 1, themeIds: plus1 },
    { level: 0, themeIds: zero },
    { level: -1, themeIds: minus1 },
    { level: -2, themeIds: minus2 },
  ];
}

const counts = (
  askedThemes: number,
  usableQuestions: number,
  askedQuestions: number,
): ValuesMap["counts"] => ({ askedThemes, totalThemes: 6, usableQuestions, askedQuestions });

function answers(...pairs: readonly (readonly [string, unknown])[]): Record<string, unknown> {
  return Object.fromEntries(pairs);
}

const imp = importanceId;
const tra = tradeoffId;

function ok(value: ValuesMap): GoldenOutcome {
  return { ok: true, value };
}

function failure(error: MapError): GoldenOutcome {
  return { ok: false, error };
}

const INVALID_CONFIG = failure({ code: "INVALID_CONFIG" });
const NO_OPINION = failure({ code: "NO_OPINION_ANSWERS" });

// ---- V01: every importance question VERY_IMPORTANT, every trade-off BALANCED, priority TR ----
const v01 = mapInput(
  TB_FULL,
  "FULL",
  answers(
    ...THEME_ORDER.flatMap((theme): [string, unknown][] => [
      [imp(theme), "VERY_IMPORTANT"],
      [tra(theme), "BALANCED"],
    ]),
    [PICK_ID, { pick: [TR] }],
  ),
);

// ---- V02: importance 200, 100, 100, 0, -100, -200; trade-off all A_LEAN; priority DECLINE ----
const v02 = mapInput(
  TB_FULL,
  "FULL",
  answers(
    [imp(TR), "VERY_IMPORTANT"],
    [imp(ED), "IMPORTANT"],
    [imp(EC), "IMPORTANT"],
    [imp(HC), "NEUTRAL"],
    [imp(DP), "NOT_VERY_IMPORTANT"],
    [imp(PR), "NOT_IMPORTANT"],
    ...THEME_ORDER.map((theme): [string, unknown] => [tra(theme), "A_LEAN"]),
    [PICK_ID, "DECLINE"],
  ),
);

// ---- V03: all 13 questions UNSURE or DECLINE ----
const v03 = mapInput(
  TB_FULL,
  "FULL",
  answers(
    ...TB_FULL.questions.map((question, index): [string, unknown] => [
      question.questionId,
      index % 2 === 0 ? "UNSURE" : "DECLINE",
    ]),
  ),
);

// ---- V04: weights 1 and 3 (TB-W QUICK) ----
const v04 = mapInput(
  TB_W,
  "QUICK",
  answers(
    ["q1", "UNSURE"],
    ["q2", "IMPORTANT"],
    ["q3", "DECLINE"],
    ["q4", "IMPORTANT"],
    ["q5", "VERY_IMPORTANT"],
  ),
);

/** A map in which one theme is asked with importance questions only (V05 to V09). */
function singleThemeMap(
  theme: ThemeValue,
  score: number,
  level: Level,
  questionCount: number,
): ValuesMap {
  const others = THEME_ORDER.filter((candidate) => candidate !== theme);
  return {
    setKind: "FULL",
    themes: themesOf([theme, det(score, level), NA]),
    importanceGroups: groupsOf(
      level === 2 ? [theme] : [],
      level === 1 ? [theme] : [],
      level === 0 ? [theme] : [],
      level === -1 ? [theme] : [],
      level === -2 ? [theme] : [],
    ),
    priority: { state: "NOT_ASKED" },
    hesitantThemes: [],
    declinedThemes: [],
    notAskedThemes: others,
    excludedQuestions: [],
    counts: counts(1, questionCount, questionCount),
    notices: { noThemeDifference: false, equalLevelGroupExists: false },
  };
}

// ---- V05 to V08: weighted averages of one theme (TB-W, one theme asked) ----
const v05 = mapInput(
  bankWithSet(TB_W, "FULL", ["tr-w1", "tr-w3"]),
  "FULL",
  answers(["tr-w1", "VERY_IMPORTANT"], ["tr-w3", "IMPORTANT"]),
);
const v06 = mapInput(
  bankWithSet(TB_W, "FULL", ["ec-w1", "ec-w2"]),
  "FULL",
  answers(["ec-w1", "IMPORTANT"], ["ec-w2", "NOT_VERY_IMPORTANT"]),
);
const hcQuestions = ["hc-w3a", "hc-w3b", "hc-w2"];
const v07 = mapInput(
  bankWithSet(TB_W, "FULL", hcQuestions),
  "FULL",
  answers(["hc-w3a", "IMPORTANT"], ["hc-w3b", "NOT_IMPORTANT"], ["hc-w2", "VERY_IMPORTANT"]),
);
const v08 = mapInput(
  bankWithSet(TB_W, "FULL", hcQuestions),
  "FULL",
  answers(["hc-w3a", "NOT_VERY_IMPORTANT"], ["hc-w3b", "VERY_IMPORTANT"], ["hc-w2", "NOT_IMPORTANT"]),
);

// ---- V09: level boundaries through the map ----
function importanceQuestion(questionId: string): MapBank["questions"][number] {
  return { questionId, kind: "IMPORTANCE", themeId: ED, weight: 1 };
}
const pairBank: MapBank = {
  themeOrder: [...THEME_ORDER],
  questions: [importanceQuestion("p1"), importanceQuestion("p2")],
  sets: [{ setKind: "FULL", themeIds: [ED], questionIds: ["p1", "p2"] }],
};
const singleBank: MapBank = {
  themeOrder: [...THEME_ORDER],
  questions: [importanceQuestion("p1")],
  sets: [{ setKind: "FULL", themeIds: [ED], questionIds: ["p1"] }],
};
const v09a = mapInput(pairBank, "FULL", answers(["p1", "IMPORTANT"], ["p2", "NEUTRAL"]));
const v09b = mapInput(pairBank, "FULL", answers(["p1", "VERY_IMPORTANT"], ["p2", "IMPORTANT"]));
const v09c = mapInput(pairBank, "FULL", answers(["p1", "NOT_VERY_IMPORTANT"], ["p2", "NEUTRAL"]));
const v09d = mapInput(pairBank, "FULL", answers(["p1", "NOT_IMPORTANT"], ["p2", "NOT_VERY_IMPORTANT"]));
const wide = { t1: 100, t2: 200 };
const v09e = mapInput(singleBank, "FULL", answers(["p1", "IMPORTANT"]), wide);
const v09f = mapInput(singleBank, "FULL", answers(["p1", "VERY_IMPORTANT"]), wide);
const v09g = mapInput(singleBank, "FULL", answers(["p1", "NOT_VERY_IMPORTANT"]), wide);
const v09h = mapInput(singleBank, "FULL", answers(["p1", "NOT_IMPORTANT"]), wide);

// ---- V10: priority themes TR and EC (given in the reverse order) ----
const v10 = mapInput(
  TB_FULL,
  "FULL",
  answers(
    [imp(TR), "NEUTRAL"],
    [imp(ED), "IMPORTANT"],
    [imp(EC), "NOT_VERY_IMPORTANT"],
    [imp(HC), "IMPORTANT"],
    [imp(DP), "IMPORTANT"],
    [imp(PR), "IMPORTANT"],
    ...THEME_ORDER.map((theme): [string, unknown] => [tra(theme), "BALANCED"]),
    [PICK_ID, { pick: [EC, TR] }],
  ),
);

// ---- V11: the priority answer changes, nothing else ----
function v11Input(pick: unknown): MapInput {
  return mapInput(
    TB_FULL,
    "FULL",
    answers(
      [imp(TR), "VERY_IMPORTANT"],
      [imp(ED), "IMPORTANT"],
      [imp(EC), "NEUTRAL"],
      [imp(HC), "NOT_VERY_IMPORTANT"],
      [imp(DP), "NOT_IMPORTANT"],
      [imp(PR), "IMPORTANT"],
      ...THEME_ORDER.map((theme): [string, unknown] => [tra(theme), "BALANCED"]),
      [PICK_ID, pick],
    ),
  );
}
const v11Themes = themesOf(
  [TR, det(200, 2), det(0, 0)],
  [ED, det(100, 1), det(0, 0)],
  [EC, det(0, 0), det(0, 0)],
  [HC, det(-100, -1), det(0, 0)],
  [DP, det(-200, -2), det(0, 0)],
  [PR, det(100, 1), det(0, 0)],
);
const v11Groups = groupsOf([TR], [ED, PR], [EC], [HC], [DP]);

// ---- V12: errors on TB-FULL, run as QUICK ----
const v12 = (given: readonly (readonly [string, unknown])[]): MapInput =>
  mapInput(TB_FULL, "QUICK", answers(...given));

// ---- V14: trade-off answers do not move the importance axis ----
const v14 = mapInput(
  TB_FULL,
  "FULL",
  answers(
    [imp(TR), "NEUTRAL"],
    [tra(TR), "A_STRONG"],
    [imp(ED), "NEUTRAL"],
    [tra(ED), "B_STRONG"],
    [imp(EC), "VERY_IMPORTANT"],
    [tra(EC), "A_STRONG"],
    [imp(HC), "VERY_IMPORTANT"],
    [tra(HC), "B_STRONG"],
    [imp(DP), "NOT_IMPORTANT"],
    [tra(DP), "A_STRONG"],
    [imp(PR), "IMPORTANT"],
    [tra(PR), "BALANCED"],
    [PICK_ID, "UNSURE"],
  ),
);

// ---- V15, V16: design examples 1 and 2 on TB-QUICK ----
const v15 = mapInput(
  TB_QUICK,
  "QUICK",
  answers(
    [imp(ED), "NOT_VERY_IMPORTANT"],
    [tra(ED), "BALANCED"],
    [imp(DP), "IMPORTANT"],
    [tra(DP), "B_STRONG"],
    [imp(PR), "VERY_IMPORTANT"],
    [tra(PR), "A_LEAN"],
  ),
);
const v16 = mapInput(
  TB_QUICK,
  "QUICK",
  answers(
    [imp(ED), "UNSURE"],
    [tra(ED), "A_STRONG"],
    [imp(DP), "IMPORTANT"],
    [tra(DP), "DECLINE"],
    [tra(PR), "B_LEAN"],
  ),
);

// ---- V17: nothing but non-opinion answers ----
const v17a = mapInput(
  TB_QUICK,
  "QUICK",
  answers(
    ...TB_QUICK.questions.map((question, index): [string, unknown] => [
      question.questionId,
      index % 2 === 0 ? "UNSURE" : "DECLINE",
    ]),
  ),
);
const v17b = mapInput(TB_QUICK, "QUICK", answers());

// ---- V18: design example 3 (FULL, 13 questions; priority given as DP, HC) ----
const v18 = mapInput(
  TB_FULL,
  "FULL",
  answers(
    [imp(TR), "IMPORTANT"],
    [tra(TR), "A_LEAN"],
    [imp(ED), "VERY_IMPORTANT"],
    [tra(ED), "BALANCED"],
    [imp(EC), "NEUTRAL"],
    [tra(EC), "B_LEAN"],
    [imp(HC), "NOT_IMPORTANT"],
    [tra(HC), "A_STRONG"],
    [imp(DP), "VERY_IMPORTANT"],
    [tra(DP), "B_STRONG"],
    [imp(PR), "IMPORTANT"],
    [tra(PR), "DECLINE"],
    [PICK_ID, { pick: [DP, HC] }],
  ),
);

const NO_NOTICES = { noThemeDifference: false, equalLevelGroupExists: false };

export const GOLDEN_VECTORS: readonly GoldenVector[] = [
  // V01: every importance answer VERY_IMPORTANT: R(2,1) = floor(401/2) = 200 (+2); every trade-off BALANCED: R(0,1) = floor(1/2) = 0; counts 6/6 themes, 13/13 questions.
  {
    id: "V01",
    title: "all VERY_IMPORTANT, all BALANCED, priority TR: six themes at +2",
    input: v01,
    expected: ok({
      setKind: "FULL",
      themes: themesOf(...THEME_ORDER.map((theme): [ThemeValue, Axis, Axis] => [theme, det(200, 2), det(0, 0)])),
      importanceGroups: groupsOf([...THEME_ORDER], [], [], [], []),
      priority: { state: "SELECTED", themeIds: [TR] },
      hesitantThemes: [],
      declinedThemes: [],
      notAskedThemes: [],
      excludedQuestions: [],
      counts: counts(6, 13, 13),
      notices: { noThemeDifference: true, equalLevelGroupExists: true },
    }),
  },
  // V02: R(2,1) = 200, R(1,1) = floor(201/2) = 100, R(0,1) = 0, R(-1,1) = floor(-199/2) = -100, R(-2,1) = floor(-399/2) = -200; trade-off A_LEAN: R(1,1) = 100 (+1) for all; priority DECLINE is excluded: usable 12 of 13.
  {
    id: "V02",
    title: "scores 200, 100, 100, 0, -100, -200; priority DECLINE",
    input: v02,
    expected: ok({
      setKind: "FULL",
      themes: themesOf(
        [TR, det(200, 2), det(100, 1)],
        [ED, det(100, 1), det(100, 1)],
        [EC, det(100, 1), det(100, 1)],
        [HC, det(0, 0), det(100, 1)],
        [DP, det(-100, -1), det(100, 1)],
        [PR, det(-200, -2), det(100, 1)],
      ),
      importanceGroups: groupsOf([TR], [ED, EC], [HC], [DP], [PR]),
      priority: { state: "DECLINE" },
      hesitantThemes: [],
      declinedThemes: [],
      notAskedThemes: [],
      excludedQuestions: [{ questionId: PICK_ID, reason: "DECLINE" }],
      counts: counts(6, 12, 13),
      notices: { noThemeDifference: false, equalLevelGroupExists: true },
    }),
  },
  // V03: none of the 13 questions has an opinion answer: NO_OPINION_ANSWERS.
  { id: "V03", title: "13 questions, all UNSURE or DECLINE", input: v03, expected: NO_OPINION },
  // V04: ED: q1 (w1) UNSURE is left out, q2 (w3) +1: n = 3, m = 3, R = floor(603/6) = 100 (+1); DP the same; PR: q5 (w1) +2, q6 has no key: n = 2, m = 1, R = floor(401/2) = 200 (+2). If q6 counted as 0, m = 4 and R = 50.
  {
    id: "V04",
    title: "weights 1 and 3: non-opinion answers leave numerator and denominator",
    input: v04,
    expected: ok({
      setKind: "QUICK",
      themes: themesOf([ED, det(100, 1), NA], [DP, det(100, 1), NA], [PR, det(200, 2), NA]),
      importanceGroups: groupsOf([PR], [ED, DP], [], [], []),
      priority: { state: "NOT_ASKED" },
      hesitantThemes: [{ themeId: ED, reasons: ["UNSURE"] }],
      declinedThemes: [
        { themeId: DP, reasons: ["DECLINE"] },
        { themeId: PR, reasons: ["UNANSWERED"] },
      ],
      notAskedThemes: [TR, EC, HC],
      excludedQuestions: [
        { questionId: "q1", reason: "UNSURE" },
        { questionId: "q3", reason: "DECLINE" },
        { questionId: "q6", reason: "UNANSWERED" },
      ],
      counts: counts(3, 3, 6),
      notices: { noThemeDifference: false, equalLevelGroupExists: true },
    }),
  },
  // V05: n = 1x2 + 3x1 = 5, m = 4: R = floor(1004/8) = 125 (125.5 down), level +1.
  { id: "V05", title: "n = 5, m = 4: R = 125, level +1", input: v05, expected: ok(singleThemeMap(TR, 125, 1, 2)) },
  // V06: n = 1x1 + 2x(-1) = -1, m = 3: R = floor(-197/6) = -33, level 0.
  { id: "V06", title: "n = -1, m = 3: R = -33, level 0", input: v06, expected: ok(singleThemeMap(EC, -33, 0, 2)) },
  // V07: n = 3x1 + 3x(-2) + 2x2 = 1, m = 8: R = floor(208/16) = 13 (12.5 goes up), level 0.
  { id: "V07", title: "n = 1, m = 8: R = 13 (12.5 up), level 0", input: v07, expected: ok(singleThemeMap(HC, 13, 0, 3)) },
  // V08: n = 3x(-1) + 3x2 + 2x(-2) = -1, m = 8: R = floor((-200+8)/16) = floor(-192/16) = -12 (-12.5 goes up), level 0.
  { id: "V08", title: "n = -1, m = 8: R = -12 (-12.5 up), level 0", input: v08, expected: ok(singleThemeMap(HC, -12, 0, 3)) },
  // V09a-h: R(1,2) = floor(202/4) = 50 (+1); R(3,2) = floor(602/4) = 150 (+2); R(-1,2) = floor(-198/4) = -50 (-1); R(-3,2) = floor(-598/4) = -150 (-2). With thresholds 100 and 200: scores 100, 200, -100, -200 give +1, +2, -1, -2.
  { id: "V09a", title: "weights 1 and 1: (+1, 0) is R(1,2) = 50, level +1", input: v09a, expected: ok(singleThemeMap(ED, 50, 1, 2)) },
  { id: "V09b", title: "weights 1 and 1: (+2, +1) is R(3,2) = 150, level +2", input: v09b, expected: ok(singleThemeMap(ED, 150, 2, 2)) },
  { id: "V09c", title: "weights 1 and 1: (-1, 0) is R(-1,2) = -50, level -1", input: v09c, expected: ok(singleThemeMap(ED, -50, -1, 2)) },
  { id: "V09d", title: "weights 1 and 1: (-2, -1) is R(-3,2) = -150, level -2", input: v09d, expected: ok(singleThemeMap(ED, -150, -2, 2)) },
  { id: "V09e", title: "thresholds 100 and 200: score 100 is level +1", input: v09e, expected: ok(singleThemeMap(ED, 100, 1, 1)) },
  { id: "V09f", title: "thresholds 100 and 200: score 200 is level +2", input: v09f, expected: ok(singleThemeMap(ED, 200, 2, 1)) },
  { id: "V09g", title: "thresholds 100 and 200: score -100 is level -1", input: v09g, expected: ok(singleThemeMap(ED, -100, -1, 1)) },
  { id: "V09h", title: "thresholds 100 and 200: score -200 is level -2", input: v09h, expected: ok(singleThemeMap(ED, -200, -2, 1)) },
  // V10: EC R(-1,1) = -100 (-1) and selected: PICK_CONFLICT; TR R(0,1) = 0 (level 0) and selected: no conflict; the others R(1,1) = 100 (+1); every trade-off R(0,1) = 0.
  {
    id: "V10",
    title: "priority TR and EC: PICK_CONFLICT for EC (level -1) only, not for TR (level 0)",
    input: v10,
    expected: ok({
      setKind: "FULL",
      themes: themesOf(
        [TR, det(0, 0), det(0, 0)],
        [ED, det(100, 1), det(0, 0)],
        [EC, det(-100, -1), det(0, 0)],
        [HC, det(100, 1), det(0, 0)],
        [DP, det(100, 1), det(0, 0)],
        [PR, det(100, 1), det(0, 0)],
      ),
      importanceGroups: groupsOf([], [ED, HC, DP, PR], [TR], [EC], []),
      priority: { state: "SELECTED", themeIds: [TR, EC] },
      hesitantThemes: [{ themeId: EC, reasons: ["PICK_CONFLICT"] }],
      declinedThemes: [],
      notAskedThemes: [],
      excludedQuestions: [],
      counts: counts(6, 13, 13),
      notices: { noThemeDifference: false, equalLevelGroupExists: true },
    }),
  },
  // V11a-b: TR 200 (+2), ED 100 (+1), EC 0, HC -100 (-1), DP -200 (-2), PR 100 (+1) in both; A: priority UNSURE is excluded (usable 12 of 13); B: priority ED, usable 13 of 13.
  {
    id: "V11a",
    title: "priority UNSURE: scores and levels as in V11b; the priority answer is excluded",
    input: v11Input("UNSURE"),
    expected: ok({
      setKind: "FULL",
      themes: v11Themes,
      importanceGroups: v11Groups,
      priority: { state: "UNSURE" },
      hesitantThemes: [],
      declinedThemes: [],
      notAskedThemes: [],
      excludedQuestions: [{ questionId: PICK_ID, reason: "UNSURE" }],
      counts: counts(6, 12, 13),
      notices: { noThemeDifference: false, equalLevelGroupExists: true },
    }),
  },
  {
    id: "V11b",
    title: "priority ED: the same scores and levels",
    input: v11Input({ pick: [ED] }),
    expected: ok({
      setKind: "FULL",
      themes: v11Themes,
      importanceGroups: v11Groups,
      priority: { state: "SELECTED", themeIds: [ED] },
      hesitantThemes: [],
      declinedThemes: [],
      notAskedThemes: [],
      excludedQuestions: [],
      counts: counts(6, 13, 13),
      notices: { noThemeDifference: false, equalLevelGroupExists: true },
    }),
  },
  // V12a-d: a key that is not a question of the QUICK set is UNKNOWN_QUESTION and wins over INVALID_ANSWER.
  {
    id: "V12a",
    title: "a question ID that is not in the bank",
    input: v12([[imp(ED), "IMPORTANT"], ["not-in-the-bank", "IMPORTANT"]]),
    expected: failure({ code: "UNKNOWN_QUESTION", questionIds: ["not-in-the-bank"] }),
  },
  {
    id: "V12b",
    title: "an answer value MAYBE",
    input: v12([[imp(ED), "MAYBE"]]),
    expected: failure({ code: "INVALID_ANSWER", questionIds: [imp(ED)] }),
  },
  {
    id: "V12c",
    title: "both: UNKNOWN_QUESTION wins",
    input: v12([["not-in-the-bank", "IMPORTANT"], [imp(ED), "MAYBE"]]),
    expected: failure({ code: "UNKNOWN_QUESTION", questionIds: ["not-in-the-bank"] }),
  },
  {
    id: "V12d",
    title: "a question of the bank that is not in the QUICK set (TR importance)",
    input: v12([[imp(ED), "IMPORTANT"], [imp(TR), "IMPORTANT"]]),
    expected: failure({ code: "UNKNOWN_QUESTION", questionIds: [imp(TR)] }),
  },
  // V13: thresholds that are not integers with 0 < T1 < T2 <= 200 (0, 150), (50, 50), (150, 50), (50, 201), (50.5, 150), (50, NaN), (-1, 150) are INVALID_CONFIG.
  ...(
    [
      [0, 150],
      [50, 50],
      [150, 50],
      [50, 201],
      [50.5, 150],
      [50, Number.NaN],
      [-1, 150],
    ] as const
  ).map(
    ([t1, t2]): GoldenVector => ({
      id: `V13-${t1}-${t2}`,
      title: `thresholds (${t1}, ${t2}) are INVALID_CONFIG`,
      input: mapInput(TB_QUICK, "QUICK", answers([imp(ED), "IMPORTANT"]), { t1, t2 }),
      expected: INVALID_CONFIG,
    }),
  ),
  // V14: importance TR, ED R(0,1) = 0; EC, HC R(2,1) = 200; DP R(-2,1) = -200; PR R(1,1) = 100. Trade-off A_STRONG 200, B_STRONG -200, BALANCED 0.
  {
    id: "V14",
    title: "trade-off answers do not move the importance axis; the priority answer UNSURE",
    input: v14,
    expected: ok({
      setKind: "FULL",
      themes: themesOf(
        [TR, det(0, 0), det(200, 2)],
        [ED, det(0, 0), det(-200, -2)],
        [EC, det(200, 2), det(200, 2)],
        [HC, det(200, 2), det(-200, -2)],
        [DP, det(-200, -2), det(200, 2)],
        [PR, det(100, 1), det(0, 0)],
      ),
      importanceGroups: groupsOf([EC, HC], [PR], [TR, ED], [], [DP]),
      priority: { state: "UNSURE" },
      hesitantThemes: [],
      declinedThemes: [],
      notAskedThemes: [],
      excludedQuestions: [{ questionId: PICK_ID, reason: "UNSURE" }],
      counts: counts(6, 12, 13),
      notices: { noThemeDifference: false, equalLevelGroupExists: true },
    }),
  },
  // V15 (design example 1): R(-1,1) = -100, R(0,1) = 0; R(1,1) = 100, R(-2,1) = -200; R(2,1) = 200, R(1,1) = 100. QUICK: priority NOT_ASKED, 3 of 6 themes.
  {
    id: "V15",
    title: "design example 1: QUICK, six opinion answers",
    input: v15,
    expected: ok({
      setKind: "QUICK",
      themes: themesOf(
        [ED, det(-100, -1), det(0, 0)],
        [DP, det(100, 1), det(-200, -2)],
        [PR, det(200, 2), det(100, 1)],
      ),
      importanceGroups: groupsOf([PR], [DP], [], [ED], []),
      priority: { state: "NOT_ASKED" },
      hesitantThemes: [],
      declinedThemes: [],
      notAskedThemes: [TR, EC, HC],
      excludedQuestions: [],
      counts: counts(3, 6, 6),
      notices: NO_NOTICES,
    }),
  },
  // V16 (design example 2): ED importance UNSURE (undetermined), trade-off R(2,1) = 200; DP importance R(1,1) = 100, trade-off DECLINE; PR importance has no key (UNANSWERED), trade-off R(-1,1) = -100.
  {
    id: "V16",
    title: "design example 2: unsure, decline, unanswered and not asked at once",
    input: v16,
    expected: ok({
      setKind: "QUICK",
      themes: themesOf(
        [ED, und("UNSURE"), det(200, 2)],
        [DP, det(100, 1), und("DECLINE")],
        [PR, und("UNANSWERED"), det(-100, -1)],
      ),
      importanceGroups: groupsOf([], [DP], [], [], []),
      priority: { state: "NOT_ASKED" },
      hesitantThemes: [{ themeId: ED, reasons: ["UNSURE"] }],
      declinedThemes: [
        { themeId: DP, reasons: ["DECLINE"] },
        { themeId: PR, reasons: ["UNANSWERED"] },
      ],
      notAskedThemes: [TR, EC, HC],
      excludedQuestions: [
        { questionId: imp(ED), reason: "UNSURE" },
        { questionId: tra(DP), reason: "DECLINE" },
        { questionId: imp(PR), reason: "UNANSWERED" },
      ],
      counts: counts(3, 3, 6),
      notices: NO_NOTICES,
    }),
  },
  // V17a-b: no opinion answer, or no key at all: NO_OPINION_ANSWERS.
  { id: "V17a", title: "six QUICK questions, all UNSURE or DECLINE", input: v17a, expected: NO_OPINION },
  { id: "V17b", title: "no answer key at all", input: v17b, expected: NO_OPINION },
  // V18 (design example 3): TR 100/100, ED 200/0, EC 0/-100, HC -200/200, DP 200/-200, PR 100/DECLINE; HC has importance -2 and trade-off +2 together; priority HC and DP (given as DP, HC); HC level -2 gives PICK_CONFLICT.
  {
    id: "V18",
    title: "design example 3: FULL, 13 questions; priority HC and DP",
    input: v18,
    expected: ok({
      setKind: "FULL",
      themes: themesOf(
        [TR, det(100, 1), det(100, 1)],
        [ED, det(200, 2), det(0, 0)],
        [EC, det(0, 0), det(-100, -1)],
        [HC, det(-200, -2), det(200, 2)],
        [DP, det(200, 2), det(-200, -2)],
        [PR, det(100, 1), und("DECLINE")],
      ),
      importanceGroups: groupsOf([ED, DP], [TR, PR], [EC], [], [HC]),
      priority: { state: "SELECTED", themeIds: [HC, DP] },
      hesitantThemes: [{ themeId: HC, reasons: ["PICK_CONFLICT"] }],
      declinedThemes: [{ themeId: PR, reasons: ["DECLINE"] }],
      notAskedThemes: [],
      excludedQuestions: [{ questionId: tra(PR), reason: "DECLINE" }],
      counts: counts(6, 12, 13),
      notices: { noThemeDifference: false, equalLevelGroupExists: true },
    }),
  },
];

/** V13: these threshold pairs are accepted; the ED importance answer IMPORTANT (score 100) has the given level. */
export const V13_ACCEPTED_THRESHOLDS: readonly { t1: number; t2: number; level: Level }[] = [
  { t1: 1, t2: 2, level: 2 },
  { t1: 100, t2: 200, level: 1 },
  { t1: 50, t2: 150, level: 1 },
];

/** The golden result views (V15, V16, V18) are fixed values in goldenViews.ts and are listed here with the vectors. */
export { GOLDEN_V15, GOLDEN_V16, GOLDEN_V18, type ViewSummary } from "./goldenViews.js";
