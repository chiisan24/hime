import { z } from "zod";

import {
  DataKindSchema,
  ISODateSchema,
  ISOInstantSchema,
  NonEmptyStringSchema,
} from "../primitives.js";

/**
 * Regional values map contracts: themes, answer values, questions and
 * diagnostic sets (the question bank), then answers and the map input and
 * output (the section further below).
 *
 * This file imports `primitives.ts` only. Every object is strict, so extra
 * and missing keys are rejected. Composition rules for a diagnostic set (for
 * example "QUICK has three themes and six questions") are not checked here;
 * the question-bank inspection checks them.
 */

// ---------------------------------------------------------------------------
// Text metrics
//
// These rules mirror the "text metrics" of the design. They are private so the
// barrel does not gain generic names.
//   lengthOf:      Unicode code points after trimming surrounding whitespace.
//   contentLength: Unicode code points after removing every whitespace
//                  character and line break (full-width and half-width forms
//                  are not distinguished: each code point counts once).
//   sentencesOf:   the non-empty pieces left after splitting on 。 ？ ！ and
//                  line breaks. The delimiters are not part of a sentence.
// ---------------------------------------------------------------------------

function codePointCount(value: string): number {
  return Array.from(value).length;
}

function lengthOf(text: string): number {
  return codePointCount(text.trim());
}

function contentLength(text: string): number {
  return codePointCount(text.replace(/\s/gu, ""));
}

function sentencesOf(text: string): string[] {
  return text.split(/[。？！\r\n]/u).filter((sentence) => sentence.trim() !== "");
}

function chars(min: number, max: number) {
  return NonEmptyStringSchema.refine((value) => {
    const length = lengthOf(value);
    return length >= min && length <= max;
  }, `Must contain ${min} to ${max} Unicode code points after trimming surrounding whitespace`);
}

const IdSchema = NonEmptyStringSchema.max(64);
const VersionSchema = z.number().int().positive();

const EXPLANATION_MIN_LENGTH = 50;
const EXPLANATION_MAX_LENGTH = 200;
const EXPLANATION_MAX_SENTENCE_LENGTH = 60;

const ExplanationSchema = NonEmptyStringSchema.superRefine((value, context) => {
  const length = contentLength(value);
  if (length < EXPLANATION_MIN_LENGTH || length > EXPLANATION_MAX_LENGTH) {
    context.addIssue({
      code: "custom",
      message: `Must contain ${EXPLANATION_MIN_LENGTH} to ${EXPLANATION_MAX_LENGTH} Unicode code points excluding whitespace and line breaks`,
    });
  }
  if (
    sentencesOf(value).some(
      (sentence) => lengthOf(sentence) > EXPLANATION_MAX_SENTENCE_LENGTH,
    )
  ) {
    context.addIssue({
      code: "custom",
      message: `Every sentence must contain no more than ${EXPLANATION_MAX_SENTENCE_LENGTH} Unicode code points`,
    });
  }
});

// ---------------------------------------------------------------------------
// Themes, kinds, levels
// ---------------------------------------------------------------------------

/** The array order is the default theme definition order (not a ranking). */
export const THEME_IDS = [
  "TRANSPORT",
  "EDUCATION_CHILDCARE",
  "ECONOMY_EMPLOYMENT",
  "HEALTHCARE_WELFARE",
  "DISASTER_PREVENTION",
  "POPULATION_REVITALIZATION",
] as const;
export const QUESTION_KINDS = ["IMPORTANCE", "TRADEOFF", "PRIORITY_PICK"] as const;
export const SET_KINDS = ["QUICK", "FULL"] as const;

export const ThemeIdSchema = z.enum(THEME_IDS);
export const QuestionKindSchema = z.enum(QUESTION_KINDS);
export const SetKindSchema = z.enum(SET_KINDS);

export const LevelSchema = z.union([
  z.literal(2),
  z.literal(1),
  z.literal(0),
  z.literal(-1),
  z.literal(-2),
]);

// ---------------------------------------------------------------------------
// Answer values
// ---------------------------------------------------------------------------

/** Importance answers, listed from +2 down to -2. */
export const IMPORTANCE_VALUE = {
  VERY_IMPORTANT: 2,
  IMPORTANT: 1,
  NEUTRAL: 0,
  NOT_VERY_IMPORTANT: -1,
  NOT_IMPORTANT: -2,
} as const;

/** Trade-off answers, listed from +2 (direction A) down to -2 (direction B). */
export const TRADEOFF_VALUE = {
  A_STRONG: 2,
  A_LEAN: 1,
  BALANCED: 0,
  B_LEAN: -1,
  B_STRONG: -2,
} as const;

/** Answers that carry no opinion value. */
export const NON_OPINION = ["UNSURE", "DECLINE", "UNANSWERED"] as const;

// ---------------------------------------------------------------------------
// Theme definitions
// ---------------------------------------------------------------------------

export const ThemeDefSchema = z
  .object({
    themeId: ThemeIdSchema,
    label: chars(1, 20),
  })
  .strict();

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/** A bias review and a human approval, valid for one version of a question. */
export const QuestionApprovalSchema = z
  .object({
    forVersion: VersionSchema,
    review: z
      .object({
        modelId: IdSchema,
        reviewedAt: ISOInstantSchema,
        verdict: z.enum(["NO_BIAS_FOUND", "BIAS_SUSPECTED"]),
        findings: z.array(z.string()),
      })
      .strict(),
    approverId: IdSchema,
    approvedAt: ISOInstantSchema,
  })
  .strict()
  .superRefine((approval, context) => {
    if (Date.parse(approval.approvedAt) < Date.parse(approval.review.reviewedAt)) {
      context.addIssue({
        code: "custom",
        message: "approvedAt must not precede the bias review time",
        path: ["approvedAt"],
      });
    }
  });

const questionBaseShape = {
  questionId: IdSchema,
  dataKind: DataKindSchema,
  author: z.enum(["HUMAN", "AI_DRAFT"]),
  createdOn: ISODateSchema,
  version: VersionSchema,
  text: chars(1, 60),
  explanation: ExplanationSchema,
  unsureLabel: chars(1, 20),
  declineLabel: chars(1, 20),
  weight: z.number().int().min(1).max(3),
  /** Only a TRADEOFF question may be true; checked on the union below. */
  swapDirections: z.boolean(),
  /** `null` means not approved. */
  approval: QuestionApprovalSchema.nullable(),
};

/** Five labels in answer-value order (+2, +1, 0, -1, -2). */
const OpinionLabelsSchema = z.tuple([
  chars(1, 20),
  chars(1, 20),
  chars(1, 20),
  chars(1, 20),
  chars(1, 20),
]);

const DirectionSchema = z
  .object({
    text: chars(1, 60),
    category: z.enum(["CHANGE", "CONTINUE", "NEUTRAL"]),
  })
  .strict();

/** Every theme exactly once, in any order. */
const EveryThemeOnceSchema = z
  .array(ThemeIdSchema)
  .length(THEME_IDS.length)
  .refine(
    (themeIds) => new Set(themeIds).size === THEME_IDS.length,
    "Must list every theme exactly once",
  );

const ImportanceQuestionSchema = z
  .object({
    ...questionBaseShape,
    kind: z.literal("IMPORTANCE"),
    themeId: ThemeIdSchema,
    opinionLabels: OpinionLabelsSchema,
  })
  .strict();

const TradeoffQuestionSchema = z
  .object({
    ...questionBaseShape,
    kind: z.literal("TRADEOFF"),
    themeId: ThemeIdSchema,
    opinionLabels: OpinionLabelsSchema,
    premise: chars(1, 60),
    directionA: DirectionSchema,
    directionB: DirectionSchema,
  })
  .strict();

const PriorityPickQuestionSchema = z
  .object({
    ...questionBaseShape,
    kind: z.literal("PRIORITY_PICK"),
    themeIds: EveryThemeOnceSchema,
    maxSelect: z.literal(2),
  })
  .strict();

export const QuestionSchema = z
  .discriminatedUnion("kind", [
    ImportanceQuestionSchema,
    TradeoffQuestionSchema,
    PriorityPickQuestionSchema,
  ])
  .superRefine((question, context) => {
    if (question.approval !== null && question.approval.forVersion !== question.version) {
      context.addIssue({
        code: "custom",
        message: "approval.forVersion must equal the question version",
        path: ["approval", "forVersion"],
      });
    }
    if (question.kind !== "TRADEOFF" && question.swapDirections) {
      context.addIssue({
        code: "custom",
        message: "swapDirections may be true only for a TRADEOFF question",
        path: ["swapDirections"],
      });
    }
  });

// ---------------------------------------------------------------------------
// Diagnostic sets and the question bank
// ---------------------------------------------------------------------------

export const DiagnosticSetSchema = z
  .object({
    setKind: SetKindSchema,
    /** Themes asked in this set. For QUICK this is where its themes are decided. */
    themeIds: z.array(ThemeIdSchema),
    /** Presentation order. Fixed, never randomised. */
    questionIds: z.array(IdSchema),
  })
  .strict()
  .superRefine((set, context) => {
    const seen = new Set<string>();
    set.questionIds.forEach((questionId, index) => {
      if (seen.has(questionId)) {
        context.addIssue({
          code: "custom",
          message: "questionIds must not contain duplicates",
          path: ["questionIds", index],
        });
      }
      seen.add(questionId);
    });
  });

export const QuestionBankSchema = z
  .object({
    schemaVersion: z.literal(1),
    dataKind: DataKindSchema,
    /** The array order is the theme definition order (not a ranking). */
    themes: z.array(ThemeDefSchema).length(THEME_IDS.length),
    /** Definition order of the bank. */
    questions: z.array(QuestionSchema),
    diagnosticSets: z.array(DiagnosticSetSchema),
  })
  .strict()
  .superRefine((bank, context) => {
    const themeIds = new Set<string>();
    bank.themes.forEach((theme, index) => {
      if (themeIds.has(theme.themeId)) {
        context.addIssue({
          code: "custom",
          message: "Each theme must be defined exactly once",
          path: ["themes", index, "themeId"],
        });
      }
      themeIds.add(theme.themeId);
    });

    const questionIds = new Set<string>();
    bank.questions.forEach((question, index) => {
      if (questionIds.has(question.questionId)) {
        context.addIssue({
          code: "custom",
          message: "questionId must be unique within the bank",
          path: ["questions", index, "questionId"],
        });
      }
      questionIds.add(question.questionId);

      if (question.dataKind !== bank.dataKind) {
        context.addIssue({
          code: "custom",
          message: "Every question dataKind must equal the bank dataKind",
          path: ["questions", index, "dataKind"],
        });
      }
    });

    const setKinds = new Set<string>();
    bank.diagnosticSets.forEach((set, index) => {
      if (setKinds.has(set.setKind)) {
        context.addIssue({
          code: "custom",
          message: "Each diagnostic set kind may appear at most once",
          path: ["diagnosticSets", index, "setKind"],
        });
      }
      setKinds.add(set.setKind);
    });
  });

export type ThemeId = z.infer<typeof ThemeIdSchema>;
export type QuestionKind = z.infer<typeof QuestionKindSchema>;
export type SetKind = z.infer<typeof SetKindSchema>;
export type Level = z.infer<typeof LevelSchema>;
export type ThemeDef = z.infer<typeof ThemeDefSchema>;
export type QuestionApproval = z.infer<typeof QuestionApprovalSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type DiagnosticSet = z.infer<typeof DiagnosticSetSchema>;
export type QuestionBank = z.infer<typeof QuestionBankSchema>;

// ===========================================================================
// Answers, and the map input / output
//
// Interpretation notes (see the task report for the reasoning):
//  - `MapInputSchema` checks structure only. Semantic faults that the map
//    generation must report as a `MapError` stay out of the schema: a threshold
//    pair outside `0 < t1 < t2 <= 200` or a set kind missing in `bank.sets`
//    (INVALID_CONFIG), answer keys that are not questions of the set
//    (UNKNOWN_QUESTION) and answer values that do not fit the question kind
//    (INVALID_ANSWER). That is why `answers` values are `unknown` there.
//  - `AnswerValueSchema` / `AnswersSchema` describe answers that are valid in
//    themselves. Whether a value fits the question kind is a question-level
//    rule and is decided by the map generation.
//  - Importance and trade-off are two independent axes. No field combines them
//    and no axis state is derived from the other axis.
//  - Nothing here carries a rank, an order value or a score across themes.
// ===========================================================================

const LEVEL_ORDER = [2, 1, 0, -1, -2] as const;

function hasDistinctItems(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/** Indexes of the entries that repeat an earlier entry. */
function repeatedIndexes(values: readonly string[]): number[] {
  return values.flatMap((value, index) => (values.indexOf(value) === index ? [] : [index]));
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/** Same members and order as the keys of `IMPORTANCE_VALUE` (checked by a test). */
const IMPORTANCE_CODES = [
  "VERY_IMPORTANT",
  "IMPORTANT",
  "NEUTRAL",
  "NOT_VERY_IMPORTANT",
  "NOT_IMPORTANT",
] as const;

/** Same members and order as the keys of `TRADEOFF_VALUE` (checked by a test). */
const TRADEOFF_CODES = ["A_STRONG", "A_LEAN", "BALANCED", "B_LEAN", "B_STRONG"] as const;

export const ImportanceCodeSchema = z.enum(IMPORTANCE_CODES);
export const TradeoffCodeSchema = z.enum(TRADEOFF_CODES);
export const NonOpinionCodeSchema = z.enum(NON_OPINION);

/**
 * One or two distinct themes. The order is the producer's own; the bank's
 * theme definition order is not known to a contract.
 */
const PickedThemesSchema = z
  .array(ThemeIdSchema)
  .min(1)
  .max(2)
  .refine(hasDistinctItems, "Must not list a theme twice");

/** An answer to the priority-theme question: one or two themes. */
export const PickAnswerSchema = z.object({ pick: PickedThemesSchema }).strict();

/**
 * Any answer value that is valid by itself: an importance code, a trade-off
 * code, a non-opinion code (UNSURE, DECLINE, UNANSWERED) or a priority pick.
 */
export const AnswerValueSchema = z.union([
  ImportanceCodeSchema,
  TradeoffCodeSchema,
  NonOpinionCodeSchema,
  PickAnswerSchema,
]);

/** Question ID to answer. A question without an answer has no key (unanswered). */
export const AnswersSchema = z.record(IdSchema, AnswerValueSchema);

// ---------------------------------------------------------------------------
// Map input
// ---------------------------------------------------------------------------

/**
 * The only facts about a question that the map generation may see. It has no
 * question text, explanation, label, issue card, fact or source (Req 7.22).
 */
export const MapQuestionSchema = z
  .object({
    questionId: IdSchema,
    kind: QuestionKindSchema,
    /** `null` for the priority-theme question, which belongs to no single theme. */
    themeId: ThemeIdSchema.nullable(),
    weight: z.number().int().min(1).max(3),
  })
  .strict()
  .superRefine((question, context) => {
    if (question.kind === "PRIORITY_PICK" && question.themeId !== null) {
      context.addIssue({
        code: "custom",
        message: "A PRIORITY_PICK question has no theme (themeId must be null)",
        path: ["themeId"],
      });
    }
    if (question.kind !== "PRIORITY_PICK" && question.themeId === null) {
      context.addIssue({
        code: "custom",
        message: "An IMPORTANCE or TRADEOFF question needs a theme",
        path: ["themeId"],
      });
    }
  });

const MapBankSchema = z
  .object({
    /** Theme definition order (not a ranking). */
    themeOrder: EveryThemeOnceSchema,
    questions: z.array(MapQuestionSchema),
    sets: z.array(DiagnosticSetSchema),
  })
  .strict()
  .superRefine((bank, context) => {
    for (const index of repeatedIndexes(bank.questions.map((question) => question.questionId))) {
      context.addIssue({
        code: "custom",
        message: "questionId must be unique within the map bank",
        path: ["questions", index, "questionId"],
      });
    }
    for (const index of repeatedIndexes(bank.sets.map((set) => set.setKind))) {
      context.addIssue({
        code: "custom",
        message: "Each diagnostic set kind may appear at most once",
        path: ["sets", index, "setKind"],
      });
    }
  });

export const MapInputSchema = z
  .object({
    setKind: SetKindSchema,
    bank: MapBankSchema,
    /**
     * Question ID to raw answer. Keys and values are not validated here: a key
     * that is not a question is UNKNOWN_QUESTION and a value that does not fit
     * the question kind is INVALID_ANSWER, both reported by the map generation.
     */
    answers: z.record(z.string(), z.unknown()),
    /** Range `0 < t1 < t2 <= 200` is checked by the map generation (INVALID_CONFIG). */
    thresholds: z.object({ t1: z.number(), t2: z.number() }).strict(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Map output
// ---------------------------------------------------------------------------

const ScoreSchema = z.number().int().min(-200).max(200);

/**
 * The state of one axis (importance or trade-off) of one theme.
 *  - DETERMINED:   at least one usable question; carries a score and a level.
 *  - UNDETERMINED: the set asks the axis, but no question has an opinion
 *                  answer; carries why (UNSURE, DECLINE, UNANSWERED).
 *  - NOT_ASKED:    the set does not ask the axis. Not an answer of any kind.
 * No state is a default or a middle value; an axis without a score has none.
 */
export const AxisStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("DETERMINED"), score: ScoreSchema, level: LevelSchema }).strict(),
  z
    .object({
      state: z.literal("UNDETERMINED"),
      reasons: z.array(NonOpinionCodeSchema).min(1).refine(hasDistinctItems, "Must not repeat a reason"),
    })
    .strict(),
  z.object({ state: z.literal("NOT_ASKED") }).strict(),
]);

/**
 * The priority themes. Decided only by the priority-theme question, never from
 * importance levels. NOT_ASKED means the set has no such question (QUICK) and is
 * different from SELECTED with zero themes, which does not exist.
 */
export const PriorityStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("NOT_ASKED") }).strict(),
  z.object({ state: z.literal("SELECTED"), themeIds: PickedThemesSchema }).strict(),
  z.object({ state: z.literal("UNSURE") }).strict(),
  z.object({ state: z.literal("DECLINE") }).strict(),
  z.object({ state: z.literal("UNANSWERED") }).strict(),
]);

const ThemeAxesSchema = z
  .object({
    themeId: ThemeIdSchema,
    importance: AxisStateSchema,
    tradeoff: AxisStateSchema,
  })
  .strict();

const ImportanceGroupSchema = z
  .object({
    level: LevelSchema,
    themeIds: z.array(ThemeIdSchema).refine(hasDistinctItems, "Must not list a theme twice"),
  })
  .strict();

const HesitantThemeSchema = z
  .object({
    themeId: ThemeIdSchema,
    reasons: z
      .array(z.enum(["UNSURE", "PICK_CONFLICT"]))
      .min(1)
      .refine(hasDistinctItems, "Must not repeat a reason"),
  })
  .strict();

const DeclinedThemeSchema = z
  .object({
    themeId: ThemeIdSchema,
    reasons: z
      .array(z.enum(["DECLINE", "UNANSWERED"]))
      .min(1)
      .refine(hasDistinctItems, "Must not repeat a reason"),
  })
  .strict();

const ExcludedQuestionSchema = z
  .object({
    questionId: IdSchema,
    /** The kind of the original answer. */
    reason: NonOpinionCodeSchema,
  })
  .strict();

const CountSchema = z.number().int().min(0);

const CountsSchema = z
  .object({
    askedThemes: CountSchema,
    totalThemes: CountSchema,
    usableQuestions: CountSchema,
    askedQuestions: CountSchema,
  })
  .strict()
  .superRefine((counts, context) => {
    if (counts.askedThemes > counts.totalThemes) {
      context.addIssue({
        code: "custom",
        message: "askedThemes must not exceed totalThemes",
        path: ["askedThemes"],
      });
    }
    if (counts.usableQuestions > counts.askedQuestions) {
      context.addIssue({
        code: "custom",
        message: "usableQuestions must not exceed askedQuestions",
        path: ["usableQuestions"],
      });
    }
  });

const NoticesSchema = z
  .object({
    noThemeDifference: z.boolean(),
    equalLevelGroupExists: z.boolean(),
  })
  .strict();

const ValuesMapObjectSchema = z
  .object({
    setKind: SetKindSchema,
    /** Six entries in theme definition order. */
    themes: z.array(ThemeAxesSchema).length(THEME_IDS.length),
    /** Exactly the five levels, +2 down to -2. Groups are not ranks. */
    importanceGroups: z.array(ImportanceGroupSchema).length(LEVEL_ORDER.length),
    priority: PriorityStateSchema,
    hesitantThemes: z.array(HesitantThemeSchema),
    declinedThemes: z.array(DeclinedThemeSchema),
    notAskedThemes: z.array(ThemeIdSchema),
    excludedQuestions: z.array(ExcludedQuestionSchema),
    counts: CountsSchema,
    notices: NoticesSchema,
  })
  .strict();

type ThemeAxes = z.infer<typeof ThemeAxesSchema>;

/**
 * Cross-field rules that keep the four states apart (not asked, unsure,
 * decline, unanswered) and keep the two axes independent:
 *  - a theme is in an importance group only when its importance axis alone is
 *    DETERMINED at that level, and every such theme is in that group;
 *  - a theme is "not asked" only when both axes are NOT_ASKED, and every such
 *    theme is listed; hesitant and declined themes are never "not asked";
 *  - the QUICK set has no priority-theme question, so its priority is NOT_ASKED.
 */
export const ValuesMapSchema = ValuesMapObjectSchema.superRefine((map, context) => {
  const flag = (path: PropertyKey[], message: string): void => {
    context.addIssue({ code: "custom", message, path });
  };

  for (const index of repeatedIndexes(map.themes.map((theme) => theme.themeId))) {
    flag(["themes", index, "themeId"], "Each theme must appear exactly once in themes");
  }
  const axesByTheme = new Map(
    map.themes.map((theme): [string, ThemeAxes] => [theme.themeId, theme]),
  );

  map.importanceGroups.forEach((group, groupIndex) => {
    if (group.level !== LEVEL_ORDER[groupIndex]) {
      flag(
        ["importanceGroups", groupIndex, "level"],
        "importanceGroups must list the levels +2, +1, 0, -1, -2 in this order",
      );
    }
    group.themeIds.forEach((themeId, position) => {
      const importance = axesByTheme.get(themeId)?.importance;
      if (
        importance === undefined ||
        importance.state !== "DETERMINED" ||
        importance.level !== group.level
      ) {
        flag(
          ["importanceGroups", groupIndex, "themeIds", position],
          "A theme joins an importance group only when its importance axis is DETERMINED at the group level",
        );
      }
    });
  });

  map.themes.forEach((theme, themeIndex) => {
    if (theme.importance.state !== "DETERMINED") {
      return;
    }
    const level = theme.importance.level;
    const group = map.importanceGroups.find((candidate) => candidate.level === level);
    if (group === undefined || !group.themeIds.includes(theme.themeId)) {
      flag(
        ["themes", themeIndex, "importance"],
        "A theme with a determined importance axis must be listed in the group of its level",
      );
    }
  });

  for (const index of repeatedIndexes(map.notAskedThemes)) {
    flag(["notAskedThemes", index], "Must not list a theme twice");
  }
  map.notAskedThemes.forEach((themeId, index) => {
    const axes = axesByTheme.get(themeId);
    if (
      axes === undefined ||
      axes.importance.state !== "NOT_ASKED" ||
      axes.tradeoff.state !== "NOT_ASKED"
    ) {
      flag(["notAskedThemes", index], "A theme is not asked only when both of its axes are NOT_ASKED");
    }
  });
  map.themes.forEach((theme, themeIndex) => {
    if (
      theme.importance.state === "NOT_ASKED" &&
      theme.tradeoff.state === "NOT_ASKED" &&
      !map.notAskedThemes.includes(theme.themeId)
    ) {
      flag(["themes", themeIndex], "A theme whose axes are both NOT_ASKED must be listed in notAskedThemes");
    }
  });

  const flagAskedOnly = (field: "hesitantThemes" | "declinedThemes", themeIds: string[]): void => {
    for (const index of repeatedIndexes(themeIds)) {
      flag([field, index, "themeId"], "Must not list a theme twice");
    }
    themeIds.forEach((themeId, index) => {
      if (map.notAskedThemes.some((notAsked) => notAsked === themeId)) {
        flag([field, index, "themeId"], "A theme that was not asked cannot be unsure or declined");
      }
    });
  };
  flagAskedOnly(
    "hesitantThemes",
    map.hesitantThemes.map((entry) => entry.themeId),
  );
  flagAskedOnly(
    "declinedThemes",
    map.declinedThemes.map((entry) => entry.themeId),
  );

  if (map.setKind === "QUICK" && map.priority.state !== "NOT_ASKED") {
    flag(
      ["priority", "state"],
      "The QUICK set has no priority-theme question, so priority must be NOT_ASKED",
    );
  }
});

// ---------------------------------------------------------------------------
// Map error
// ---------------------------------------------------------------------------

/**
 * `questionIds` echoes the offending answer keys as they were given, so they
 * are plain non-empty distinct strings rather than validated question IDs.
 */
const OffendingQuestionIdsSchema = z
  .array(z.string())
  .min(1)
  .refine(hasDistinctItems, "Must not list a question ID twice");

export const MapErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("UNKNOWN_QUESTION"), questionIds: OffendingQuestionIdsSchema }).strict(),
  z.object({ code: z.literal("INVALID_ANSWER"), questionIds: OffendingQuestionIdsSchema }).strict(),
  z.object({ code: z.literal("NO_OPINION_ANSWERS") }).strict(),
  z.object({ code: z.literal("INVALID_CONFIG") }).strict(),
]);

export type ImportanceCode = z.infer<typeof ImportanceCodeSchema>;
export type TradeoffCode = z.infer<typeof TradeoffCodeSchema>;
export type NonOpinionCode = z.infer<typeof NonOpinionCodeSchema>;
export type PickAnswer = z.infer<typeof PickAnswerSchema>;
export type AnswerValue = z.infer<typeof AnswerValueSchema>;
export type Answers = Readonly<z.infer<typeof AnswersSchema>>;
export type MapQuestion = z.infer<typeof MapQuestionSchema>;
export type MapInput = z.infer<typeof MapInputSchema>;
export type AxisState = z.infer<typeof AxisStateSchema>;
export type PriorityState = z.infer<typeof PriorityStateSchema>;
export type ValuesMap = z.infer<typeof ValuesMapSchema>;
export type MapError = z.infer<typeof MapErrorSchema>;
