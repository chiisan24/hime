import {
  ImportanceCodeSchema,
  TradeoffCodeSchema,
  type ImportanceCode,
  type Question,
  type ThemeId,
  type TradeoffCode,
} from "@ehime-vote-navigator/contracts";

import { annotateTerms, type GlossaryEntry } from "../view/annotateTerms.js";
import { entryOf, say, themeName } from "../view/support.js";
import type { JaText, PresentedOption, QuestionPresentation, ViewBundle } from "../view/viewTypes.js";
import { isAnswered } from "./answerEditing.js";
import type { Hint, Session } from "./sessionTypes.js";

/**
 * The view model of the question screen (Req 2). A screen draws it as it is and sends
 * the `event` of the option that was pressed; it makes no event, no label and no order
 * of its own. The bundle is given apart from the session because the session holds only
 * the small bundle that the state machine reads.
 */

type Answer = Session["answers"][string] | undefined;

function answerOf(session: Session, questionId: string): Answer {
  return Object.hasOwn(session.answers, questionId) ? session.answers[questionId] : undefined;
}

function opinionOptions(
  question: Exclude<Question, { kind: "PRIORITY_PICK" }>,
  answer: Answer,
): PresentedOption[] {
  const codes: readonly (ImportanceCode | TradeoffCode)[] =
    question.kind === "IMPORTANCE" ? ImportanceCodeSchema.options : TradeoffCodeSchema.options;
  const options = question.opinionLabels.flatMap((label, index): PresentedOption[] => {
    const code = codes[index];
    return code === undefined
      ? []
      : [
          {
            id: code,
            kind: "OPINION",
            label,
            selected: answer === code,
            event: { type: "SELECT_ANSWER", questionId: question.questionId, value: code },
          },
        ];
  });
  // The directions are shown in the other order, so the five options follow them; the answer values stay.
  return question.kind === "TRADEOFF" && question.swapDirections ? options.reverse() : options;
}

function nonOpinionOptions(question: Question, answer: Answer): PresentedOption[] {
  const isPick = question.kind === "PRIORITY_PICK";
  return (["UNSURE", "DECLINE"] as const).map((value) => ({
    id: value,
    kind: value,
    label: value === "UNSURE" ? question.unsureLabel : question.declineLabel,
    selected: answer === value,
    event: isPick
      ? { type: "TOGGLE_PICK", questionId: question.questionId, item: value }
      : { type: "SELECT_ANSWER", questionId: question.questionId, value },
  }));
}

function pickOptions(bundle: ViewBundle, question: Question, answer: Answer): PresentedOption[] {
  const picked: readonly ThemeId[] = typeof answer === "object" ? answer.pick : [];
  return bundle.themes.map((theme) => ({
    id: theme.themeId,
    kind: "THEME",
    label: theme.label,
    selected: picked.includes(theme.themeId),
    event: { type: "TOGGLE_PICK", questionId: question.questionId, item: theme.themeId },
  }));
}

function hintTextOf(bundle: ViewBundle, hint: Hint): JaText | null {
  switch (hint) {
    case "NONE":
      return null;
    case "SELECT_REQUIRED":
      return say(bundle, "ui.hint.SELECT_REQUIRED");
    case "PICK_LIMIT":
      return say(bundle, "ui.hint.PICK_LIMIT");
  }
}

export function presentQuestion(bundle: ViewBundle, session: Session, hint: Hint): QuestionPresentation {
  const set = bundle.diagnosticSets.find((candidate) => candidate.setKind === session.setKind);
  const questionId = set?.questionIds[session.position];
  const question = bundle.questions.find((candidate) => candidate.questionId === questionId);
  if (set === undefined || questionId === undefined || question === undefined) {
    throw new Error("There is no question to present at this position");
  }
  const answer = answerOf(session, question.questionId);
  const glossary: GlossaryEntry[] = bundle.cards
    .filter((card) => question.kind === "PRIORITY_PICK" || card.themeId === question.themeId)
    .flatMap((card) => card.glossary);
  const [text = [], explanation = []] = annotateTerms([question.text, question.explanation], glossary);
  const cardLinks =
    question.kind === "PRIORITY_PICK"
      ? []
      : bundle.cards
          .filter((card) => card.themeId === question.themeId)
          .map((card) => ({ cardId: card.cardId, title: card.title }));
  const last = session.position === set.questionIds.length - 1;
  const directions =
    question.kind === "TRADEOFF"
      ? ([
          { side: "A", text: question.directionA.text },
          { side: "B", text: question.directionB.text },
        ] as const)
      : null;
  return {
    questionId: question.questionId,
    kind: question.kind,
    position: { current: session.position + 1, total: set.questionIds.length },
    themeLabel: question.kind === "PRIORITY_PICK" ? say(bundle, "reflection.crossTheme") : themeName(bundle, question.themeId),
    text,
    explanation,
    premise: question.kind === "TRADEOFF" ? question.premise : null,
    directions: directions === null ? null : question.kind === "TRADEOFF" && question.swapDirections ? [...directions].reverse() : directions,
    options: [
      ...(question.kind === "PRIORITY_PICK" ? pickOptions(bundle, question, answer) : opinionOptions(question, answer)),
      ...nonOpinionOptions(question, answer),
    ],
    cardLinks,
    dataKindLabel: entryOf(bundle, bundle.meta.dataKind, `label.dataKind.${bundle.meta.dataKind}`),
    aiLabel: bundle.questions.some((candidate) => candidate.questionId === question.questionId && candidate.author === "AI_DRAFT")
      ? entryOf(bundle, "AI_DRAFT", "label.ai")
      : null,
    hintText: hintTextOf(bundle, hint),
    nav: {
      backEnabled: session.position >= 1,
      nextEnabled: isAnswered(session.answers, question.questionId),
      nextLabel: say(bundle, last ? "ui.showResult" : "ui.next"),
    },
  };
}
