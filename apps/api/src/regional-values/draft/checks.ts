import { DRAFT_OUTPUT_SCHEMAS, QuestionSchema, THEME_IDS } from "@ehime-vote-navigator/contracts";
import type {
  BackgroundDraftOutput,
  DataKind,
  DraftTask,
  EvidenceUnit,
  FactItem,
  IssueCandidateOutput,
  IssueSummaryOutput,
  NeutralityConfig,
  Question,
  QuestionBank,
  QuestionDraftOutput,
  TermGlossOutput,
  ThemeDef,
} from "@ehime-vote-navigator/contracts";
import {
  checkFactComparison,
  checkGrounding,
  factGroundingText,
  IMPORTANCE_LABELS,
  inspectQuestionBank,
} from "@ehime-vote-navigator/domain";

/**
 * The deterministic checks of an AI output (Req 8.8 to 8.11, 8.18, 8.24, 8.26). An output is saved
 * only when every check passes. A check that fails is reported with its ID and the place in the
 * output (`factSummary[0]`, `basisFactIds[1]`), never with the text of the output, so that a log of
 * the result does not carry what the model wrote (Req 8.17).
 *
 * The checks do not call an AI and do not read the clock or the disk: the same output and the
 * same context give the same result.
 */

export const DRAFT_CHECK_IDS = [
  "DR_JSON",
  "DR_GROUND_EXISTS",
  "DR_GROUND_MATCH",
  "DR_FORBIDDEN_WORDS",
  "DR_SENTENCE_LENGTH",
  "DR_THEME_RANGE",
  "DR_QUESTION_RULES",
  "DR_CANDIDATE_FACTS",
  "DR_CAUSAL_CLAIMS",
  "DR_HEDGE_REQUIRED",
  "DR_COMPARISON",
  "DR_UNKNOWN_REQUIRED",
  "DR_DIRECTION_RULES",
] as const;

export type DraftCheckId = (typeof DRAFT_CHECK_IDS)[number];

export type DraftCheckViolation = Readonly<{ check: DraftCheckId; target: string }>;

/**
 * The lists that a person approves before they are used (Open Decisions (20)). They are not in the
 * settings contract yet, so the checks take them as an argument, and a test gives its own words.
 */
export type DraftCheckWords = Readonly<{
  /** Words that state a cause. A sentence of an issue candidate has none. */
  causalWords: readonly string[];
  /** The endings of a sentence that is a hypothesis. The statement of an issue candidate ends with one. */
  hedgeEndings: readonly string[];
  /** Words that compare. A sentence that has one rests on two facts at least. */
  comparisonWords: readonly string[];
}>;

export type DraftCheckConfig = Readonly<{
  neutrality: NeutralityConfig;
  /** The proper nouns that a sentence may use only when its ground has them (`build.json`). */
  properNouns: readonly string[];
  /** The length of a sentence at most, in code points (`draft.json`; 60 by design). */
  sentenceMaxChars: number;
  words: DraftCheckWords;
}>;

export type DraftCheckContext = Readonly<{
  task: DraftTask;
  dataKind: DataKind;
  config: DraftCheckConfig;
  /** The quotations of the input. */
  evidence: readonly EvidenceUnit[];
  /** The fact items of the input. */
  facts: readonly FactItem[];
  /** The six themes with their labels. */
  themes: readonly ThemeDef[];
  /** The numbers and years of the fact items, for the check of a question (`NO_FACT_NUMBERS`). */
  factNumerals: ReadonlySet<string>;
  /** The date written in a question that is assembled from a draft (`YYYY-MM-DD`). */
  today: string;
}>;

export type DraftCheckResult =
  | Readonly<{ ok: true; output: unknown }>
  | Readonly<{ ok: false; violations: readonly DraftCheckViolation[] }>;

/** The message of the contract when the ground of a sentence is not among the basis facts. */
const GROUND_NOT_IN_BASIS = "A ground must be one of basisFactIds";
/** The messages of a text with a limit of 60 code points. */
const SIXTY_LIMIT = /^Must contain \d+ to 60 Unicode code points/u;
const UNKNOWN_KEYS = ["notDeterminable", "additionalChecks"] as const;
const THEME_PLACEHOLDER = "{テーマ名}";

function codePoints(text: string): number {
  return Array.from(text.trim()).length;
}

function includesAny(text: string, words: readonly string[]): boolean {
  const normalized = text.normalize("NFKC");
  return words.some((word) => word !== "" && normalized.includes(word.normalize("NFKC")));
}

function formatPath(path: readonly PropertyKey[]): string {
  const text = path.reduce<string>(
    (current, key) => (typeof key === "number" ? `${current}[${key}]` : current === "" ? String(key) : `${current}.${String(key)}`),
    "",
  );
  return text === "" ? "output" : text;
}

/** The numbers and years of the fact items, as they would be written in a sentence (the check `NO_FACT_NUMBERS`). */
export function factNumeralsOf(facts: readonly FactItem[]): ReadonlySet<string> {
  const numerals = new Set<string>();
  for (const fact of facts) {
    numerals.add(String(fact.value.amount));
    numerals.add(typeof fact.surveyDate === "number" ? String(fact.surveyDate) : fact.surveyDate.slice(0, 4));
  }
  return numerals;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Found = Map<string, DraftCheckViolation>;

function add(found: Found, check: DraftCheckId, target: string): void {
  found.set(`${check}\u0000${target}`, { check, target });
}

function listOf(found: Found): readonly DraftCheckViolation[] {
  return [...found.values()].sort((first, second) => DRAFT_CHECK_IDS.indexOf(first.check) - DRAFT_CHECK_IDS.indexOf(second.check));
}

/** The check that a failure of the contract belongs to. */
function checkOfSchemaIssue(message: string, path: readonly PropertyKey[]): DraftCheckId {
  if (path[path.length - 1] === "themeId") {
    return "DR_THEME_RANGE";
  }
  if (message === GROUND_NOT_IN_BASIS) {
    return "DR_CANDIDATE_FACTS";
  }
  if (SIXTY_LIMIT.test(message)) {
    return "DR_SENTENCE_LENGTH";
  }
  return "DR_JSON";
}

type Unit = Readonly<{ target: string; text: string }>;
/** A sentence that rests on something: the IDs of the quotations or of the fact items. */
type GroundedUnit = Unit & Readonly<{ grounds: readonly string[] }>;

const FORBIDDEN_LISTS = (config: NeutralityConfig): readonly string[] => [
  ...config.bannedWords,
  ...config.loadedWords,
  ...config.wordCategories.SUPERIORITY,
  ...config.wordCategories.RECOMMENDATION,
  ...config.wordCategories.VOTE_URGING,
];

function checkForbiddenWords(found: Found, units: readonly Unit[], config: NeutralityConfig): void {
  const words = FORBIDDEN_LISTS(config);
  for (const unit of units) {
    if (includesAny(unit.text, words)) {
      add(found, "DR_FORBIDDEN_WORDS", unit.target);
    }
  }
}

function checkSentenceLength(found: Found, units: readonly Unit[], max: number): void {
  for (const unit of units) {
    if (codePoints(unit.text) > max) {
      add(found, "DR_SENTENCE_LENGTH", unit.target);
    }
  }
}

// ---------------------------------------------------------------------------
// The tasks that write a card (the ground is a quotation)
// ---------------------------------------------------------------------------

function groundedUnitsOfCard(task: DraftTask, output: unknown): { sentences: GroundedUnit[]; plain: Unit[] } {
  if (task === "ISSUE_SUMMARY") {
    const value = output as IssueSummaryOutput;
    return {
      sentences: value.sentences.map((sentence, index) => ({ target: `sentences[${index}]`, text: sentence.text, grounds: sentence.groundIds })),
      plain: [],
    };
  }
  if (task === "BACKGROUND_DRAFT") {
    const value = output as BackgroundDraftOutput;
    return {
      sentences: value.sentences.map((sentence, index) => ({ target: `sentences[${index}]`, text: sentence.text, grounds: sentence.groundIds })),
      plain: [{ target: "title", text: value.title }],
    };
  }
  const value = output as TermGlossOutput;
  return {
    sentences: value.items.flatMap((item, itemIndex) =>
      item.sentences.map((sentence, index) => ({
        target: `items[${itemIndex}].sentences[${index}]`,
        text: sentence.text,
        grounds: sentence.groundIds,
      })),
    ),
    plain: value.items.map((item, index) => ({ target: `items[${index}].term`, text: item.term })),
  };
}

function checkCard(found: Found, context: DraftCheckContext, output: unknown): void {
  const { sentences, plain } = groundedUnitsOfCard(context.task, output);
  const evidenceById = new Map(context.evidence.map((unit) => [unit.evidenceId, unit]));
  for (const sentence of sentences) {
    const quotes: string[] = [];
    sentence.grounds.forEach((groundId, index) => {
      const unit = evidenceById.get(groundId);
      if (unit === undefined) {
        add(found, "DR_GROUND_EXISTS", `${sentence.target}.groundIds[${index}]`);
      } else {
        quotes.push(unit.text);
      }
    });
    if (quotes.length > 0) {
      const failures = checkGrounding(sentence.text, quotes.join("\n"), {
        properNouns: context.config.properNouns,
        numeralExemptWords: context.config.neutrality.numeralExemptWords,
      });
      if (failures.length > 0) {
        add(found, "DR_GROUND_MATCH", sentence.target);
      }
    }
  }
  checkForbiddenWords(found, [...sentences, ...plain], context.config.neutrality);
  checkSentenceLength(found, sentences, context.config.sentenceMaxChars);
}

// ---------------------------------------------------------------------------
// An issue candidate (the ground is a fact item)
// ---------------------------------------------------------------------------

function candidateUnits(candidate: IssueCandidateOutput): { sentences: GroundedUnit[]; others: Unit[]; directions: Unit[] } {
  const sentences: GroundedUnit[] = [
    { target: "statement", text: candidate.statement, grounds: candidate.basisFactIds },
    ...candidate.factSummary.map((sentence, index) => ({
      target: `factSummary[${index}]`,
      text: sentence.text,
      grounds: sentence.groundFactIds,
    })),
    ...candidate.background.map((sentence, index) => ({
      target: `background[${index}]`,
      text: sentence.text,
      grounds: sentence.groundFactIds,
    })),
  ];
  const others: Unit[] = [
    { target: "title", text: candidate.title },
    ...candidate.notDeterminable.map((text, index) => ({ target: `notDeterminable[${index}]`, text })),
    ...candidate.additionalChecks.map((text, index) => ({ target: `additionalChecks[${index}]`, text })),
    ...candidate.decisionScenes.map((text, index) => ({ target: `decisionScenes[${index}]`, text })),
  ];
  const directions: Unit[] = candidate.responseDirections.flatMap((direction, index) => [
    { target: `responseDirections[${index}].label`, text: direction.label },
    { target: `responseDirections[${index}].description`, text: direction.description },
  ]);
  return { sentences, others, directions };
}

function checkCandidate(found: Found, context: DraftCheckContext, candidate: IssueCandidateOutput): void {
  const { config } = context;
  const { neutrality, words } = config;
  const { sentences, others, directions } = candidateUnits(candidate);
  const factsById = new Map(context.facts.map((fact) => [fact.factId, fact]));

  // The basis exists among the facts of the input (which the gate found verified).
  candidate.basisFactIds.forEach((factId, index) => {
    if (!factsById.has(factId)) {
      add(found, "DR_CANDIDATE_FACTS", `basisFactIds[${index}]`);
    }
  });

  // Every number, date and proper noun of the candidate is in the facts that it rests on.
  const basisText = candidate.basisFactIds
    .map((factId) => factsById.get(factId))
    .filter((fact): fact is FactItem => fact !== undefined)
    .map(factGroundingText)
    .join("\n");
  const grounded = (unit: Unit, quote: string): void => {
    const failures = checkGrounding(unit.text, quote, {
      properNouns: config.properNouns,
      numeralExemptWords: neutrality.numeralExemptWords,
    });
    if (failures.length > 0) {
      add(found, "DR_CANDIDATE_FACTS", unit.target);
    }
  };
  for (const sentence of sentences) {
    const known = sentence.grounds.map((factId) => factsById.get(factId));
    // (The grounds of the statement are the basis facts, which are checked above.)
    if (sentence.target !== "statement" && known.some((fact) => fact === undefined)) {
      add(found, "DR_CANDIDATE_FACTS", sentence.target);
    }
    const quote =
      sentence.target === "statement"
        ? basisText
        : known
            .filter((fact): fact is FactItem => fact !== undefined)
            .map(factGroundingText)
            .join("\n");
    grounded(sentence, quote);
  }
  for (const unit of [...others, ...directions]) {
    grounded(unit, basisText);
  }

  checkForbiddenWords(found, [...sentences, ...others, ...directions], neutrality);
  checkSentenceLength(
    found,
    [...sentences, ...others, ...directions.filter((unit) => unit.target.endsWith(".description"))],
    config.sentenceMaxChars,
  );

  // A candidate is a hypothesis, not a cause.
  for (const sentence of sentences) {
    if (includesAny(sentence.text, words.causalWords)) {
      add(found, "DR_CAUSAL_CLAIMS", sentence.target);
    }
  }
  const statement = candidate.statement.trim().replace(/[。.．]+$/u, "");
  if (!words.hedgeEndings.some((ending) => ending !== "" && statement.normalize("NFKC").endsWith(ending.normalize("NFKC")))) {
    add(found, "DR_HEDGE_REQUIRED", "statement");
  }

  // A comparison rests on two facts at least, and the facts may be put side by side (Req 7.26).
  for (const sentence of sentences) {
    if (!includesAny(sentence.text, words.comparisonWords)) {
      continue;
    }
    const facts = [...new Set(sentence.grounds)]
      .map((factId) => factsById.get(factId))
      .filter((fact): fact is FactItem => fact !== undefined);
    let valid = facts.length >= 2;
    for (let first = 0; valid && first < facts.length; first += 1) {
      for (let second = first + 1; valid && second < facts.length; second += 1) {
        const left = facts[first];
        const right = facts[second];
        if (left === undefined || right === undefined) {
          continue;
        }
        const result = checkFactComparison({
          operands: [left, right],
          use: { kind: "COMPARE" },
          sentence: sentence.text,
          superiorityWords: neutrality.wordCategories.SUPERIORITY,
        });
        valid = result.ok;
      }
    }
    if (!valid) {
      add(found, "DR_COMPARISON", sentence.target);
    }
  }

  // (What cannot be told and what to check next are stated: the contract needs one of each, and
  // a missing or an empty list is reported as DR_UNKNOWN_REQUIRED in `runDraftChecks`.)

  // The directions are for reference: said in a positive way, not exclusive, and without a recommendation.
  const negative = [...neutrality.negationWords, ...neutrality.exclusiveWords];
  const stance = [...neutrality.wordCategories.SUPERIORITY, ...neutrality.wordCategories.RECOMMENDATION, ...neutrality.wordCategories.VOTE_URGING];
  for (const direction of directions) {
    const description = direction.target.endsWith(".description");
    if ((description && includesAny(direction.text, negative)) || includesAny(direction.text, stance)) {
      add(found, "DR_DIRECTION_RULES", direction.target);
    }
  }
}

// ---------------------------------------------------------------------------
// A question
// ---------------------------------------------------------------------------

/** The question that a draft stands for, built so that the checks of the question bank can read it (D13). */
function assembleQuestion(
  draft: QuestionDraftOutput,
  context: DraftCheckContext,
): { ok: true; question: unknown } | { ok: false } {
  const base = {
    questionId: "draft-question",
    dataKind: context.dataKind,
    author: "AI_DRAFT" as const,
    createdOn: context.today,
    version: 1,
    explanation: draft.explanation,
    unsureLabel: draft.unsureLabel,
    declineLabel: draft.declineLabel,
    weight: 1,
    swapDirections: false,
    approval: null,
  };
  if (draft.kind === "IMPORTANCE") {
    const label = context.themes.find((theme) => theme.themeId === draft.themeId)?.label;
    if (label === undefined) {
      return { ok: false };
    }
    return {
      ok: true,
      question: {
        ...base,
        kind: "IMPORTANCE",
        themeId: draft.themeId,
        text: context.config.neutrality.importanceTemplate.replaceAll(THEME_PLACEHOLDER, () => label),
        opinionLabels: [...IMPORTANCE_LABELS],
      },
    };
  }
  if (draft.kind === "TRADEOFF") {
    return {
      ok: true,
      question: {
        ...base,
        kind: "TRADEOFF",
        themeId: draft.themeId,
        text: draft.text,
        opinionLabels: draft.opinionLabels,
        premise: draft.premise,
        directionA: draft.directionA,
        directionB: draft.directionB,
      },
    };
  }
  return { ok: true, question: { ...base, kind: "PRIORITY_PICK", text: draft.text, themeIds: [...THEME_IDS], maxSelect: 2 } };
}

function questionUnits(draft: QuestionDraftOutput): Unit[] {
  const common: Unit[] = [
    { target: "explanation", text: draft.explanation },
    { target: "unsureLabel", text: draft.unsureLabel },
    { target: "declineLabel", text: draft.declineLabel },
  ];
  if (draft.kind === "IMPORTANCE") {
    return common;
  }
  if (draft.kind === "PRIORITY_PICK") {
    return [{ target: "text", text: draft.text }, ...common];
  }
  return [
    { target: "text", text: draft.text },
    { target: "premise", text: draft.premise },
    { target: "directionA.text", text: draft.directionA.text },
    { target: "directionB.text", text: draft.directionB.text },
    ...draft.opinionLabels.map((text, index) => ({ target: `opinionLabels[${index}]`, text })),
    ...common,
  ];
}

/** The checks of a question that are about one question (the balance of a set is not). */
const QUESTION_CHECKS_APPLIED = new Set([
  "NAME_FREE",
  "SINGLE_ISSUE",
  "LOADED_TERMS",
  "IMPORTANCE_PATTERN",
  "PREMISE",
  "POSITIVE_FRAMING",
  "NON_EXCLUSIVE",
  "NO_FACT_NUMBERS",
  "LABEL_SYMMETRY",
  "DIRECTION_LENGTH",
]);

function checkQuestion(found: Found, context: DraftCheckContext, draft: QuestionDraftOutput): void {
  checkForbiddenWords(found, questionUnits(draft), context.config.neutrality);

  const assembled = assembleQuestion(draft, context);
  if (!assembled.ok) {
    add(found, "DR_QUESTION_RULES", "themeId");
    return;
  }
  const parsed = QuestionSchema.safeParse(assembled.question);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      add(found, "DR_QUESTION_RULES", formatPath(issue.path));
    }
    return;
  }
  const question: Question = parsed.data;
  const bank: QuestionBank = {
    schemaVersion: 1,
    dataKind: context.dataKind,
    themes: [...context.themes],
    questions: [question],
    diagnosticSets: [],
  };
  const inspected = inspectQuestionBank(bank, { config: context.config.neutrality, factNumerals: context.factNumerals });
  if (!inspected.ok) {
    for (const violation of inspected.error.violations) {
      if (QUESTION_CHECKS_APPLIED.has(violation.check)) {
        add(found, "DR_QUESTION_RULES", violation.check);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/**
 * Checks the text that the model returned. The text must be one JSON object as it stands: nothing
 * is cut off, repaired or re-formatted (a fence of code or a sentence before the object is a failure
 * of `DR_JSON`).
 */
export function runDraftChecks(rawText: string, context: DraftCheckContext): DraftCheckResult {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return { ok: false, violations: [{ check: "DR_JSON", target: "output" }] };
  }

  const found: Found = new Map();

  // What a candidate must state is its own check, so a missing or an empty list is reported there.
  const attributed = new Set<string>();
  if (context.task === "ISSUE_CANDIDATE" && isRecord(json)) {
    for (const key of UNKNOWN_KEYS) {
      const value = json[key];
      if (value === undefined || (Array.isArray(value) && value.length === 0)) {
        add(found, "DR_UNKNOWN_REQUIRED", key);
        attributed.add(key);
      }
    }
  }

  const parsed = DRAFT_OUTPUT_SCHEMAS[context.task].safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const first = issue.path[0];
      if (issue.path.length === 1 && typeof first === "string" && attributed.has(first)) {
        continue;
      }
      add(found, checkOfSchemaIssue(issue.message, issue.path), formatPath(issue.path));
    }
    return { ok: false, violations: listOf(found) };
  }

  switch (context.task) {
    case "ISSUE_CANDIDATE":
      checkCandidate(found, context, parsed.data as IssueCandidateOutput);
      break;
    case "ISSUE_SUMMARY":
    case "BACKGROUND_DRAFT":
    case "TERM_GLOSS":
      checkCard(found, context, parsed.data);
      break;
    case "QUESTION_DRAFT":
      checkQuestion(found, context, parsed.data as QuestionDraftOutput);
      break;
    case "NEUTRALITY_REVIEW":
    case "THEME_CLASSIFY":
      break;
  }

  return found.size === 0 ? { ok: true, output: parsed.data } : { ok: false, violations: listOf(found) };
}
