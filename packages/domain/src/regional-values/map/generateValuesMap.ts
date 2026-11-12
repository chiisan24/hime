import {
  ValuesMapSchema,
  type MapError,
  type MapInput,
  type ValuesMap,
} from "@ehime-vote-navigator/contracts";

import type { Result } from "../../result.js";
import { computeAxes } from "./axes.js";
import { classify } from "./classify.js";
import { validateMapInput } from "./validateInput.js";

/**
 * Builds the values map from the answers. A pure function: it uses no random
 * number, no clock and no network, it does not change its input, and it does not
 * depend on the order in which the answers are listed. The only input about a
 * question is its ID, kind, theme and weight; nothing about facts or sources.
 *
 * A fault in the input (settings, a key, a value, no opinion answer) is returned
 * as a `MapError`, with no part of a map. An output that does not satisfy
 * `ValuesMapSchema` is a defect of this implementation and throws.
 */
export function generateValuesMap(input: MapInput): Result<ValuesMap, MapError> {
  const validated = validateMapInput(input);
  if (!validated.ok) {
    return validated;
  }

  const axes = computeAxes(validated.value);
  const draft = {
    setKind: validated.value.setKind,
    themes: axes.map((theme) => ({
      themeId: theme.themeId,
      importance: theme.importance,
      tradeoff: theme.tradeoff,
    })),
    ...classify(validated.value, axes),
  };

  const checked = ValuesMapSchema.safeParse(draft);
  if (!checked.success) {
    // Paths only: no answer value and no question ID goes into the message.
    const paths = checked.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`generateValuesMap produced an output that violates ValuesMapSchema (${paths})`);
  }
  return { ok: true, value: checked.data };
}