import type { Answers, MapError, SetKind, ThemeId, ValuesMap } from "@ehime-vote-navigator/contracts";

import { generateValuesMap } from "../../../packages/domain/src/regional-values/map/index.js";
import { toMapInput } from "../../../packages/domain/src/regional-values/session/toMapInput.js";
import { buildResultViewModel } from "../../../packages/domain/src/regional-values/view/buildResultViewModel.js";
import type { Result } from "../../../packages/domain/src/result.js";
import type {
  ResultMapView,
  ResultViewModel,
  ViewBundle,
} from "../../../packages/domain/src/regional-values/view/viewTypes.js";
import { PICK_ID, importanceId, tradeoffId } from "./testBanks.js";

/** Answers of the design examples, and helpers that build a result view model from them. */

const ED: ThemeId = "EDUCATION_CHILDCARE";
const DP: ThemeId = "DISASTER_PREVENTION";
const PR: ThemeId = "POPULATION_REVITALIZATION";
const TR: ThemeId = "TRANSPORT";
const EC: ThemeId = "ECONOMY_EMPLOYMENT";
const HC: ThemeId = "HEALTHCARE_WELFARE";

/** Design example 1 (V15): QUICK, six opinion answers. */
export const ANSWERS_V15: Answers = {
  [importanceId(ED)]: "NOT_VERY_IMPORTANT",
  [tradeoffId(ED)]: "BALANCED",
  [importanceId(DP)]: "IMPORTANT",
  [tradeoffId(DP)]: "B_STRONG",
  [importanceId(PR)]: "VERY_IMPORTANT",
  [tradeoffId(PR)]: "A_LEAN",
};

/** Design example 2 (V16): QUICK, unsure, decline and unanswered at once. */
export const ANSWERS_V16: Answers = {
  [importanceId(ED)]: "UNSURE",
  [tradeoffId(ED)]: "A_STRONG",
  [importanceId(DP)]: "IMPORTANT",
  [tradeoffId(DP)]: "DECLINE",
  [tradeoffId(PR)]: "B_LEAN",
};

/** Design example 3 (V18): FULL, thirteen questions; priority DP and HC. */
export const ANSWERS_V18: Answers = {
  [importanceId(TR)]: "IMPORTANT",
  [tradeoffId(TR)]: "A_LEAN",
  [importanceId(ED)]: "VERY_IMPORTANT",
  [tradeoffId(ED)]: "BALANCED",
  [importanceId(EC)]: "NEUTRAL",
  [tradeoffId(EC)]: "B_LEAN",
  [importanceId(HC)]: "NOT_IMPORTANT",
  [tradeoffId(HC)]: "A_STRONG",
  [importanceId(DP)]: "VERY_IMPORTANT",
  [tradeoffId(DP)]: "B_STRONG",
  [importanceId(PR)]: "IMPORTANT",
  [tradeoffId(PR)]: "DECLINE",
  [PICK_ID]: { pick: [DP, HC] },
};

export function mapOf(bundle: ViewBundle, setKind: SetKind, answers: Answers): Result<ValuesMap, MapError> {
  return generateValuesMap(toMapInput(bundle, setKind, answers));
}

/** The map of a successful generation; throws when the answers do not make one. */
export function mapValue(bundle: ViewBundle, setKind: SetKind, answers: Answers): ValuesMap {
  const result = mapOf(bundle, setKind, answers);
  if (!result.ok) {
    throw new Error(`the answers make no map: ${result.error.code}`);
  }
  return result.value;
}

export function viewOf(
  bundle: ViewBundle,
  setKind: SetKind,
  answers: Answers,
  previous: ValuesMap | null = null,
  focusThemeId: ThemeId | null = null,
): ResultViewModel {
  return buildResultViewModel({ bundle, setKind, answers, current: mapOf(bundle, setKind, answers), previous, focusThemeId });
}

export function mapViewOf(
  bundle: ViewBundle,
  setKind: SetKind,
  answers: Answers,
  previous: ValuesMap | null = null,
): ResultMapView {
  const view = viewOf(bundle, setKind, answers, previous);
  if (view.kind !== "MAP") {
    throw new Error("the view is not a map view");
  }
  return view;
}