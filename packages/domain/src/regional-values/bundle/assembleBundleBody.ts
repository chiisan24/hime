import type {
  AiContribution,
  BuildKind,
  DataKind,
  DataMode,
  DiagnosticSet,
  FixedTexts,
  GateFinding,
  GateReasonCode,
  GuidanceQuestion,
  IssueCard,
  MapConfig,
  Question,
  QuestionBank,
  ResolvedDataMode,
  ResultText,
  SetKind,
  ThemeId,
} from "@ehime-vote-navigator/contracts";

import type { Result } from "../../result.js";
import { hasCurrentApproval, setsBreakingComposition } from "../bank/balanceChecks.js";
import { gateFinding } from "../content/gateFinding.js";

/**
 * Assembling the body of a bundle (design: "ビルドパイプライン" step 8; Req 3.2, 3.10, 7.10, 7.15).
 *
 * It is a pure function. It takes records that were already checked, keeps the records that may be
 * published, leaves the others out with a finding, and refuses the whole bundle when a required part
 * is not there. It reads no file and no clock, and it does not change its input. The body has
 * everything of the bundle except `meta.contentHash`, which `finalizeBundle` adds.
 */

/** What the build knows about the bundle apart from its records. */
export type BundleIdentity = Readonly<{
  buildKind: BuildKind;
  /** The data kind of every record of the bundle. */
  dataKind: DataKind;
  dataModeRequested: DataMode;
  dataModeResolved: ResolvedDataMode;
  switched: boolean;
  switchReasonCodes: readonly GateReasonCode[];
  generatedAt: string;
  dataVersion: string;
}>;

export type AssemblyInput = Readonly<{
  identity: BundleIdentity;
  bank: QuestionBank;
  cards: readonly IssueCard[];
  resultTexts: readonly ResultText[];
  fixedTexts: FixedTexts;
  guidance: readonly GuidanceQuestion[];
  mapConfig: MapConfig;
  aiContribution: AiContribution;
}>;

/** The bundle without `meta.contentHash`. */
export type BundleBody = Readonly<{
  meta: Readonly<{
    schemaVersion: 1;
    generatedAt: string;
    dataVersion: string;
    buildKind: BuildKind;
    dataKind: DataKind;
    dataModeRequested: DataMode;
    dataModeResolved: ResolvedDataMode;
    switched: boolean;
    switchReasonCodes: readonly GateReasonCode[];
  }>;
  themes: QuestionBank["themes"];
  questions: readonly Question[];
  diagnosticSets: readonly DiagnosticSet[];
  cards: readonly IssueCard[];
  resultTexts: readonly ResultText[];
  fixedTexts: FixedTexts;
  guidance: readonly GuidanceQuestion[];
  mapConfig: MapConfig;
  aiContribution: AiContribution;
}>;

export type Assembly = Readonly<{
  body: BundleBody;
  /**
   * What was left out for lack of an approval, and why: a question without a current approval, and a
   * card, a result text or a guidance question that is not approved. A FULL set that is left out has
   * no finding of its own, because that is not an error, and a record that is approved but used only
   * by that set is simply not in the body.
   */
  excluded: readonly GateFinding[];
}>;

/** The bundle is refused. The findings name what is missing or wrong. */
export type AssemblyRefusal = Readonly<{ findings: readonly GateFinding[] }>;

const SCENES = ["ELECTION", "MOVE_OR_JOB", "DAILY_LIFE"] as const;
const AXES = ["IMPORTANCE", "TRADEOFF"] as const;
const LEVELS = [2, 1, 0, -1, -2] as const;

const approved = (record: Readonly<{ approval: Readonly<{ status: string }> }>): boolean =>
  record.approval.status === "APPROVED";

function resultTarget(text: ResultText): string {
  return `${text.themeId}/${text.axis}/${text.level}`;
}

function guidanceTarget(item: GuidanceQuestion): string {
  return `${item.themeId}/${item.scene}`;
}

/** What a diagnostic set still lacks, as findings. Empty when the set is ready to be published. */
function lacksOf(
  set: DiagnosticSet,
  members: readonly Question[],
  input: AssemblyInput,
  approvedQuestions: ReadonlySet<string>,
): GateFinding[] {
  const lacks: GateFinding[] = [];
  const unknown = set.questionIds.length - members.length;
  if (unknown > 0) {
    lacks.push(gateFinding("SET_COMPOSITION_INVALID", "DIAGNOSTIC_SET", set.setKind));
  }
  for (const member of members) {
    if (!approvedQuestions.has(member.questionId)) {
      lacks.push(gateFinding("QUESTION_NOT_APPROVED", "QUESTION", member.questionId));
    }
  }
  for (const themeId of set.themeIds) {
    for (const axis of AXES) {
      for (const level of LEVELS) {
        const text = input.resultTexts.find(
          (candidate) => candidate.themeId === themeId && candidate.axis === axis && candidate.level === level,
        );
        if (text === undefined || !approved(text)) {
          lacks.push(gateFinding("RESULT_TEXT_NOT_APPROVED", "RESULT_TEXT", `${themeId}/${axis}/${level}`));
        }
      }
    }
    for (const scene of SCENES) {
      const item = input.guidance.find((candidate) => candidate.themeId === themeId && candidate.scene === scene);
      if (item === undefined || !approved(item)) {
        lacks.push(gateFinding("FIXED_TEXT_NOT_APPROVED", "GUIDANCE_QUESTION", `${themeId}/${scene}`));
      }
    }
    if (!input.cards.some((card) => card.themeId === themeId && approved(card))) {
      lacks.push(gateFinding("CARD_COVERAGE_MISSING", "ISSUE_CARD", themeId));
    }
  }
  return lacks;
}

/**
 * Builds the body of a bundle from checked records.
 *
 * - A record of another data kind than the bundle's is refused (`DATA_KIND_MIXED`, Req 7.10).
 * - A diagnostic set that breaks its composition is refused whatever its kind (Req 3.2): this is the
 *   situation "構成違反" of the design table, and it is not turned into a quiet omission.
 * - QUICK is required. If it is not defined, the bundle is refused with `REAL_DATA_ABSENT`; if it is
 *   defined but lacks an approval, a result text, a guidance question or a card, the bundle is
 *   refused with the findings of what lacks.
 * - FULL is optional. If it is not defined, or lacks something, it is left out without a finding and
 *   without an error, and the records that only it needed are left out with it.
 * - A fixed text that is not approved refuses the bundle.
 * - A record that is not approved is never published; it is left out with a finding.
 */
export function assembleBundleBody(input: AssemblyInput): Result<Assembly, AssemblyRefusal> {
  const { identity, bank, cards, resultTexts, fixedTexts, guidance } = input;

  const kinds: readonly DataKind[] = [
    bank.dataKind,
    fixedTexts.dataKind,
    ...bank.questions.map((question) => question.dataKind),
    ...cards.map((card) => card.dataKind),
    ...resultTexts.map((text) => text.dataKind),
  ];
  if (kinds.some((kind) => kind !== identity.dataKind)) {
    return { ok: false, error: { findings: [gateFinding("DATA_KIND_MIXED", "BUNDLE", null)] } };
  }

  const brokenSets = setsBreakingComposition(bank);
  const refusals: GateFinding[] = brokenSets.map((setKind) =>
    gateFinding("SET_COMPOSITION_INVALID", "DIAGNOSTIC_SET", setKind),
  );
  for (const item of fixedTexts.items) {
    if (!approved(item)) {
      refusals.push(gateFinding("FIXED_TEXT_NOT_APPROVED", "FIXED_TEXT", item.key));
    }
  }

  const byId = new Map(bank.questions.map((question) => [question.questionId, question]));
  const approvedQuestions = new Set(
    bank.questions.filter((question) => hasCurrentApproval(question)).map((question) => question.questionId),
  );
  const broken = new Set<SetKind>(brokenSets);

  const readySets: DiagnosticSet[] = [];
  for (const kind of ["QUICK", "FULL"] as const) {
    const set = bank.diagnosticSets.find((candidate) => candidate.setKind === kind);
    if (set === undefined) {
      if (kind === "QUICK") {
        refusals.push(gateFinding("REAL_DATA_ABSENT", "DIAGNOSTIC_SET", "QUICK"));
      }
      continue;
    }
    if (broken.has(kind)) {
      continue;
    }
    const members = set.questionIds.flatMap((id) => {
      const question = byId.get(id);
      return question === undefined ? [] : [question];
    });
    const lacks = lacksOf(set, members, input, approvedQuestions);
    if (lacks.length === 0) {
      readySets.push(set);
    } else if (kind === "QUICK") {
      refusals.push(...lacks);
    }
  }

  if (refusals.length > 0) {
    return { ok: false, error: { findings: refusals } };
  }

  const usedQuestions = new Set(readySets.flatMap((set) => set.questionIds));
  const usedThemes = new Set<ThemeId>(readySets.flatMap((set) => set.themeIds));
  const excluded: GateFinding[] = [];

  for (const question of bank.questions) {
    if (!approvedQuestions.has(question.questionId)) {
      excluded.push(gateFinding("QUESTION_NOT_APPROVED", "QUESTION", question.questionId));
    }
  }
  for (const card of cards) {
    if (!approved(card)) {
      excluded.push(gateFinding("CARD_NOT_APPROVED", "ISSUE_CARD", card.cardId));
    }
  }
  for (const text of resultTexts) {
    if (!approved(text)) {
      excluded.push(gateFinding("RESULT_TEXT_NOT_APPROVED", "RESULT_TEXT", resultTarget(text)));
    }
  }
  for (const item of guidance) {
    if (!approved(item)) {
      excluded.push(gateFinding("FIXED_TEXT_NOT_APPROVED", "GUIDANCE_QUESTION", guidanceTarget(item)));
    }
  }

  return {
    ok: true,
    value: {
      body: {
        meta: {
          schemaVersion: 1,
          generatedAt: identity.generatedAt,
          dataVersion: identity.dataVersion,
          buildKind: identity.buildKind,
          dataKind: identity.dataKind,
          dataModeRequested: identity.dataModeRequested,
          dataModeResolved: identity.dataModeResolved,
          switched: identity.switched,
          switchReasonCodes: identity.switchReasonCodes,
        },
        themes: bank.themes,
        questions: bank.questions.filter((question) => usedQuestions.has(question.questionId)),
        diagnosticSets: readySets,
        cards: cards.filter((card) => approved(card) && usedThemes.has(card.themeId)),
        resultTexts: resultTexts.filter((text) => approved(text) && usedThemes.has(text.themeId)),
        fixedTexts,
        guidance: guidance.filter((item) => approved(item) && usedThemes.has(item.themeId)),
        mapConfig: input.mapConfig,
        aiContribution: input.aiContribution,
      },
      excluded,
    },
  };
}
