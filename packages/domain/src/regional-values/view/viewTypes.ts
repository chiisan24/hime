import type {
  DataKind,
  DiagnosticSet,
  FixedTexts,
  GuidanceQuestion,
  IssueCard,
  Level,
  MapConfig,
  MapError,
  Question,
  QuestionKind,
  ResultText,
  ThemeDef,
  ThemeId,
} from "@ehime-vote-navigator/contracts";

import type { DiagnosticEvent, QuestionId } from "../session/sessionTypes.js";

/**
 * The view models of the regional values map. Types only (no Zod): a screen draws
 * these values in the given order and decides nothing. Every text is already
 * fixed; a screen neither joins nor edits it.
 */

export type JaText = string;

/** A text with technical terms noted. Only the first occurrence on a screen is noted (Req 11.11). */
export type RichText = readonly (
  | Readonly<{ t: "text"; v: string }>
  | Readonly<{ t: "term"; v: string; description: string }>
)[];

/** `code` is a stable ID for tests and for aria. */
export type Entry = Readonly<{ code: string; text: JaText }>;
export type ThemeRef = Readonly<{ themeId: ThemeId; name: JaText }>;

// ---------------------------------------------------------------------------
// The bundle that the view reads
// ---------------------------------------------------------------------------


export type AiContribution = Readonly<{
  DRAFTED: number;
  REJECTED_BY_CHECKS: number;
  HUMAN_EDITED: number;
  HUMAN_REJECTED: number;
}>;

/**
 * The read-only part of a published bundle that the view reads. It satisfies the
 * smaller `SessionBundle` of the state machine structurally (checked by a test).
 */
export type ViewBundle = Readonly<{
  meta: Readonly<{ dataKind: DataKind }>;
  /** The array order is the theme definition order (not a ranking). */
  themes: readonly ThemeDef[];
  questions: readonly Question[];
  diagnosticSets: readonly DiagnosticSet[];
  mapConfig: MapConfig;
  cards: readonly IssueCard[];
  resultTexts: readonly ResultText[];
  fixedTexts: FixedTexts;
  guidance: readonly GuidanceQuestion[];
  aiContribution: AiContribution;
}>;

// ---------------------------------------------------------------------------
// Frame, errors
// ---------------------------------------------------------------------------

export type FrameView = Readonly<{
  dataKind: DataKind;
  /** Always shown; it cannot be closed (Req 10.12, 10.18). */
  banner: Entry;
  /** One operation reaches the About screen (Req 5.13, 10.19). */
  aboutLink: Entry;
}>;

export type ResultErrorView = Readonly<{
  kind: "ERROR";
  frame: FrameView;
  code: MapError["code"];
  message: JaText;
  /** REVIEW_ANSWERS or RESTART; empty for INVALID_CONFIG (Req 5.14 c). */
  actions: readonly Entry[];
}>;

/**
 * An unexpected internal error (Req 5.19). It holds fixed texts only: no message of
 * the error, no answer value, no question ID. `frame` is null when no bundle is
 * known; then `message` is the reload guide.
 */
export type UnexpectedErrorView = Readonly<{
  kind: "UNEXPECTED_ERROR";
  frame: FrameView | null;
  message: JaText;
  /** "Start again" when a bundle is known; empty otherwise. */
  actions: readonly Entry[];
  restartNote: JaText | null;
}>;

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type SectionId =
  | "notice"
  | "explainer"
  | "priority"
  | "importance"
  | "tradeoff"
  | "hesitant"
  | "declined"
  | "undetermined"
  | "notAsked"
  | "counts"
  | "reflection"
  | "diff"
  | "guidance";

export type DiffCell = Readonly<{ before: JaText; after: JaText; changed: boolean; note: JaText }>;

export type ThemeDrilldown = Readonly<{
  explanations: readonly Readonly<{ questionId: QuestionId; text: RichText }>[];
  cardLinks: readonly Readonly<{ cardId: string; title: JaText }>[];
  edit: Readonly<{ label: JaText; event: DiagnosticEvent }>;
}>;

export type ChartBand = Readonly<{
  id: string;
  heading: JaText;
  chips: readonly Readonly<{ themeId: ThemeId; name: JaText; badges: readonly Entry[] }>[];
}>;

export type ResultMapView = Readonly<{
  kind: "MAP";
  frame: FrameView;
  /** A screen draws in this order; the reading order is the same. */
  sectionOrder: readonly SectionId[];
  /** Neither folded nor closable (Req 5.9). */
  notice: JaText;
  explainer: Readonly<{
    heading: JaText;
    items: readonly Readonly<{
      code: "STAGE_MEANING" | "GROUP_READING" | "HESITANT_MEANING";
      heading: JaText;
      body: readonly JaText[];
    }>[];
  }>;
  priority: Readonly<{
    heading: JaText;
    state: "NOT_ASKED" | "SELECTED" | "NONE_SELECTED";
    text: JaText | null;
    themes: readonly ThemeRef[];
  }>;
  importance: Readonly<{
    heading: JaText;
    noThemeDifference: JaText | null;
    equalLevelNote: JaText | null;
    chart: Readonly<{ heading: JaText; bands: readonly ChartBand[] }>;
    /** Five groups, +2 down to -2 (Req 5.2). */
    groups: readonly Readonly<{
      level: Level;
      heading: JaText;
      themes: readonly (ThemeRef & Readonly<{ explanation: RichText }>)[];
      emptyText: JaText | null;
    }>[];
  }>;
  tradeoff: Readonly<{
    heading: JaText;
    lead: JaText;
    items: readonly (ThemeRef & Readonly<{ text: RichText; importanceLabel: JaText }>)[];
    emptyText: JaText | null;
  }>;
  hesitant: Readonly<{
    heading: JaText;
    items: readonly (ThemeRef &
      Readonly<{ reasons: readonly Entry[]; drilldown: ThemeDrilldown | null }>)[];
    emptyText: JaText | null;
  }>;
  declined: Readonly<{
    heading: JaText;
    columns: readonly Readonly<{
      code: "DECLINE" | "UNANSWERED";
      heading: JaText;
      themes: readonly ThemeRef[];
      emptyText: JaText | null;
    }>[];
  }>;
  undetermined: Readonly<{
    heading: JaText;
    items: readonly (ThemeRef &
      Readonly<{
        axis: "IMPORTANCE" | "TRADEOFF";
        axisName: JaText;
        statement: JaText;
        reasons: readonly Entry[];
      }>)[];
  }>;
  notAsked: Readonly<{
    heading: JaText;
    items: readonly (ThemeRef & Readonly<{ text: JaText }>)[];
    emptyText: JaText | null;
  }>;
  counts: Readonly<{ themes: JaText; questions: JaText }>;
  reflection: Readonly<{
    heading: JaText;
    rows: readonly Readonly<{
      position: number;
      themeLabel: JaText;
      question: JaText;
      answer: JaText;
      /** Whether the result of the theme changed; null without a previous result or for the cross-theme question. */
      change: Entry | null;
    }>[];
  }>;
  diff: Readonly<{
    heading: JaText;
    rows: readonly Readonly<{ theme: ThemeRef; importance: DiffCell; tradeoff: DiffCell }>[];
  }> | null;
  guidance: Readonly<{
    heading: JaText;
    emptyText: JaText | null;
    items: readonly Readonly<{
      theme: ThemeRef;
      scenes: readonly Readonly<{
        scene: "ELECTION" | "MOVE_OR_JOB" | "DAILY_LIFE";
        sceneLabel: JaText;
        question: JaText;
        link: Readonly<{ href: string; label: JaText }> | null;
      }>[];
    }>[];
  }>;
}>;

export type ResultViewModel = ResultMapView | ResultErrorView;

// ---------------------------------------------------------------------------
// Question screen, issue card, About
// ---------------------------------------------------------------------------

export type PresentedOption = Readonly<{
  id: string;
  kind: "OPINION" | "UNSURE" | "DECLINE" | "THEME";
  label: JaText;
  selected: boolean;
  /** The event to send when pressed. A screen does not make events. */
  event: DiagnosticEvent;
}>;

export type QuestionPresentation = Readonly<{
  questionId: QuestionId;
  kind: QuestionKind;
  /** 1-based (Req 2.2). */
  position: Readonly<{ current: number; total: number }>;
  themeLabel: JaText;
  text: RichText;
  explanation: RichText;
  premise: JaText | null;
  /** In display order, with `swapDirections` applied (Req 2.4). */
  directions: readonly Readonly<{ side: "A" | "B"; text: JaText }>[] | null;
  /** In display order. The answer values are not swapped. */
  options: readonly PresentedOption[];
  cardLinks: readonly Readonly<{ cardId: string; title: JaText }>[];
  dataKindLabel: Entry;
  aiLabel: Entry | null;
  hintText: JaText | null;
  nav: Readonly<{ backEnabled: boolean; nextEnabled: boolean; nextLabel: JaText }>;
}>;

export type CardView = Readonly<{
  cardId: string;
  title: JaText;
  themeName: JaText;
  dataKindLabel: Readonly<{ kind: DataKind; text: JaText }>;
  aiLabel: JaText | null;
  background: RichText;
  glossary: readonly Readonly<{ term: JaText; description: JaText }>[];
  quote: JaText;
  sources: readonly Readonly<{
    publisher: JaText | null;
    publishedOn: JaText | null;
    retrievedAt: JaText | null;
    link: Readonly<{ href: string; label: JaText }> | null;
    documentId: string | null;
  }>[];
  facts: readonly Readonly<{
    sentence: JaText;
    area: JaText;
    surveyDate: JaText;
    publisher: JaText | null;
    license: Readonly<{ name: JaText; href: string }> | null;
    credit: readonly JaText[];
    processing: JaText;
  }>[];
  updatedOn: JaText;
}>;

export type AboutView = Readonly<{
  frame: FrameView;
  questions: readonly Readonly<{
    questionId: QuestionId;
    themeLabel: JaText;
    author: JaText;
    approverId: string;
  }>[];
  rules: readonly Readonly<{
    code: "MAPPING" | "WEIGHT" | "NON_OPINION" | "GROUPING";
    heading: JaText;
    body: JaText;
  }>[];
  thresholds: Readonly<{ t1: number; t2: number; text: JaText }>;
  dataKind: Readonly<{ kind: DataKind; label: JaText; description: JaText }>;
  aiScope: readonly JaText[];
  coverage: Readonly<{ totalQuestions: JaText; totalThemes: JaText; limitNote: JaText }>;
  aiContribution: readonly Readonly<{
    code: "DRAFTED" | "REJECTED_BY_CHECKS" | "HUMAN_EDITED" | "HUMAN_REJECTED";
    label: JaText;
    value: number;
  }>[];
  unofficial: JaText | null;
}>;