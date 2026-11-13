import type { MapError } from "@ehime-vote-navigator/contracts";

import { buildFrame } from "./frame.js";
import { entryOf, say } from "./support.js";
import type { Entry, ResultErrorView, UnexpectedErrorView, ViewBundle } from "./viewTypes.js";

type ActionCode = "REVIEW_ANSWERS" | "RESTART";

/**
 * What a user may do after each error (Req 5.14): review the answers when nothing
 * had an opinion, start again when the input did not fit the bank, and nothing when
 * the settings are wrong. The error view holds no theme, level, class or count.
 */
const ACTIONS: Readonly<Record<MapError["code"], readonly ActionCode[]>> = {
  NO_OPINION_ANSWERS: ["REVIEW_ANSWERS"],
  UNKNOWN_QUESTION: ["RESTART"],
  INVALID_ANSWER: ["RESTART"],
  INVALID_CONFIG: [],
};

function action(bundle: ViewBundle, code: ActionCode): Entry {
  return entryOf(bundle, code, code === "RESTART" ? "action.RESTART" : "action.REVIEW_ANSWERS");
}

/** Only the code of the error is read; the offending question IDs are never shown. */
export function buildErrorView(bundle: ViewBundle, error: MapError): ResultErrorView {
  return {
    kind: "ERROR",
    frame: buildFrame(bundle),
    code: error.code,
    message: say(bundle, `error.${error.code}`),
    actions: ACTIONS[error.code].map((code) => action(bundle, code)),
  };
}

/**
 * The guide to reload the page, for an unexpected error when no bundle is known (so
 * no approved fixed text can be read). PROVISIONAL WORDING: it needs a human
 * approval, like the load-failure texts of the bundle loading task.
 */
export const RELOAD_GUIDE_TEXT = "ページを再読み込みしてください。";

/**
 * The view of an unexpected internal error (Req 5.19). With a bundle: the fixed text
 * of the error, one way out (start again), and the note that starting again deletes
 * the answers. Without a bundle: the reload guide only. It never shows the error
 * itself, an answer value or a question ID, because it never receives them.
 */
export function buildUnexpectedErrorView(bundle: ViewBundle | null): UnexpectedErrorView {
  if (bundle === null) {
    return {
      kind: "UNEXPECTED_ERROR",
      frame: null,
      message: RELOAD_GUIDE_TEXT,
      actions: [],
      restartNote: null,
    };
  }
  return {
    kind: "UNEXPECTED_ERROR",
    frame: buildFrame(bundle),
    message: say(bundle, "error.UNEXPECTED"),
    actions: [action(bundle, "RESTART")],
    restartNote: say(bundle, "error.UNEXPECTED.restartNote"),
  };
}