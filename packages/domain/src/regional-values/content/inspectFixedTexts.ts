import {
  GUIDANCE_SCENES,
  RESULT_AXES,
  allowedPlaceholders,
  isFixedTextKey,
  placeholdersIn,
  requiredFixedTextKeys,
} from "@ehime-vote-navigator/contracts";
import type {
  FixedTexts,
  GateFinding,
  GuidanceQuestion,
  Level,
  NeutralityConfig,
  ResultText,
  ThemeId,
} from "@ehime-vote-navigator/contracts";

import { containsAny, lengthOf, sentencesOf } from "../bank/textMetrics.js";
import { gateFinding } from "./gateFinding.js";

/**
 * The deterministic checks of the texts that a person writes and approves (8.8): the fixed texts,
 * the result texts and the guidance questions. They call no AI. A text that breaks a rule is
 * `FIXED_TEXT_INVALID` (a defect that approval does not mend); a text that is not approved, or a
 * required text that is missing, is a shortage that a record can supply. A finding carries a code
 * and an ID only, never the text.
 */

/** The longest sentence of a shown text (Req 11.7). */
const SENTENCE_MAX_CHARS = 60;

/** The fixed text that is exempt from the banned words: the notice says that the result is not a recommendation (Req 5.12). */
const NOTICE_KEY = "notice";

/** One direction with a degree: どちらかを選ぶなら、◯◯では△△を先に進めたい考えに近い（やや／強く） (Req 5.3, 5.18). */
const ONE_SIDED = /^どちらかを選ぶなら、(.+)では(.+)を先に進めたい考えに近い（(やや|強く)）。?$/u;

const EQUAL_PHRASE = "同じくらい";

type Rules = Readonly<{ bannedWords: readonly string[]; userClaims: readonly RegExp[] }>;

function rulesOf(config: NeutralityConfig): Rules {
  return {
    bannedWords: [...config.bannedWords, ...Object.values(config.wordCategories).flat()],
    userClaims: config.userClaimPatterns.map((pattern) => new RegExp(pattern, "u")),
  };
}

function hasLongSentence(text: string): boolean {
  return sentencesOf(text).some((sentence) => lengthOf(sentence) > SENTENCE_MAX_CHARS);
}

/** A sentence that tells what the user is: a character, a belief or an attribute (Req 5.10). */
function claimsUser(text: string, rules: Rules): boolean {
  const normalized = text.normalize("NFKC");
  return rules.userClaims.some((claim) => claim.test(text) || claim.test(normalized));
}

/**
 * The degree word of a trade-off result text of this level: やや for 1 and -1, 強く for 2 and -2.
 * A text of level 0 states both directions as equal and is not of the one-sided form.
 */
export function matchesTradeoffForm(level: Level, text: string): boolean {
  const trimmed = text.trim();
  if (sentencesOf(trimmed).length !== 1) {
    return false;
  }
  const match = ONE_SIDED.exec(trimmed);
  if (level === 0) {
    return match === null && trimmed.includes(EQUAL_PHRASE) && !/やや|強く/u.test(trimmed);
  }
  return match !== null && match[3] === (Math.abs(level) === 1 ? "やや" : "強く");
}

// ---------------------------------------------------------------------------
// Fixed texts
// ---------------------------------------------------------------------------

/**
 * The fixed texts as the check takes them. The key is any string, because a key that is not in
 * the closed list is one of the things that the check reports. `FixedTexts` fits this type.
 */
export type FixedTextsToCheck = Readonly<{
  dataKind: FixedTexts["dataKind"];
  items: readonly Readonly<{ key: string; text: string; approval: FixedTexts["items"][number]["approval"] }>[];
}>;

/**
 * Checks every fixed text of the bundle (Req 5.12, 5.10, 11.7): no banned word (the notice is
 * exempt), no sentence that tells what the user is, no sentence of more than 60 characters, and
 * only the placeholders that the key allows. A key that is not in the closed list, and a key that
 * appears twice, are invalid. A required key that is missing, and a text that is not approved,
 * are shortages.
 */
export function inspectFixedTexts(fixedTexts: FixedTextsToCheck, config: NeutralityConfig): GateFinding[] {
  const rules = rulesOf(config);
  const findings: GateFinding[] = [];
  const seen = new Set<string>();

  for (const item of fixedTexts.items) {
    const duplicate = seen.has(item.key);
    seen.add(item.key);
    const allowed = isFixedTextKey(item.key) ? allowedPlaceholders(item.key) : [];
    const invalid =
      duplicate ||
      !isFixedTextKey(item.key) ||
      (item.key !== NOTICE_KEY && containsAny(item.text, rules.bannedWords)) ||
      claimsUser(item.text, rules) ||
      hasLongSentence(item.text) ||
      placeholdersIn(item.text).some((name) => !allowed.includes(name));
    if (invalid) {
      findings.push(gateFinding("FIXED_TEXT_INVALID", "FIXED_TEXT", item.key));
    }
    if (item.approval.status !== "APPROVED") {
      findings.push(gateFinding("FIXED_TEXT_NOT_APPROVED", "FIXED_TEXT", item.key));
    }
  }

  for (const key of requiredFixedTextKeys(fixedTexts.dataKind)) {
    if (!seen.has(key)) {
      findings.push(gateFinding("FIXED_TEXT_NOT_APPROVED", "FIXED_TEXT", key));
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Result texts
// ---------------------------------------------------------------------------

const LEVELS: readonly Level[] = [2, 1, 0, -1, -2];

function resultTarget(themeId: string, axis: string, level: number): string {
  return `${themeId}/${axis}/${level}`;
}

/**
 * Checks the result texts (Req 5.3, 5.10, 5.12, 5.18, 11.7). Every text has no banned word, no
 * sentence that tells what the user is, and no sentence of more than 60 characters. A trade-off
 * text is also of the one-sided form with the degree of its level (or states both directions as
 * equal at level 0), and has no negation word and no word that makes light of the other direction.
 * A text that is not approved is a shortage. `requiredThemes` are the themes of the diagnostic
 * set: each needs a text for both axes and the five levels, and a missing one is a shortage.
 */
export function inspectResultTexts(
  resultTexts: readonly ResultText[],
  config: NeutralityConfig,
  requiredThemes: readonly ThemeId[] = [],
): GateFinding[] {
  const rules = rulesOf(config);
  const findings: GateFinding[] = [];
  const seen = new Set<string>();

  for (const item of resultTexts) {
    const target = resultTarget(item.themeId, item.axis, item.level);
    const duplicate = seen.has(target);
    seen.add(target);
    const tradeoffViolation =
      item.axis === "TRADEOFF" &&
      (!matchesTradeoffForm(item.level, item.text) ||
        containsAny(item.text, [...config.negationWords, ...config.disparagingWords]));
    const invalid =
      duplicate ||
      containsAny(item.text, rules.bannedWords) ||
      claimsUser(item.text, rules) ||
      hasLongSentence(item.text) ||
      tradeoffViolation;
    if (invalid) {
      findings.push(gateFinding("FIXED_TEXT_INVALID", "RESULT_TEXT", target));
    }
    if (item.approval.status !== "APPROVED") {
      findings.push(gateFinding("RESULT_TEXT_NOT_APPROVED", "RESULT_TEXT", target));
    }
  }

  for (const themeId of new Set(requiredThemes)) {
    for (const axis of RESULT_AXES) {
      for (const level of LEVELS) {
        const target = resultTarget(themeId, axis, level);
        if (!seen.has(target)) {
          findings.push(gateFinding("RESULT_TEXT_NOT_APPROVED", "RESULT_TEXT", target));
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Guidance questions
// ---------------------------------------------------------------------------

function guidanceTarget(themeId: string, scene: string): string {
  return `${themeId}/${scene}`;
}

/** The question mark particle at the end of a guidance question, with or without the mark (Req 6.6). */
const QUESTION_END = /か[？?]?$/u;

/**
 * Checks the guidance questions (Req 6.6, 6.7, 11.7). A question is one sentence of at most 60
 * characters that ends with か, and has no name of the list (a candidate, a party, a municipality,
 * a business, a workplace, a place of residence), no banned word and no word that urges a
 * particular choice. A question that is not approved is a shortage. `requiredThemes` are the
 * themes of the diagnostic set: each needs a question for the three scenes, and a missing one is
 * a shortage.
 */
export function inspectGuidance(
  guidance: readonly GuidanceQuestion[],
  config: NeutralityConfig,
  requiredThemes: readonly ThemeId[] = [],
): GateFinding[] {
  const rules = rulesOf(config);
  const findings: GateFinding[] = [];
  const seen = new Set<string>();

  for (const item of guidance) {
    const target = guidanceTarget(item.themeId, item.scene);
    const duplicate = seen.has(target);
    seen.add(target);
    const text = item.text.trim();
    const invalid =
      duplicate ||
      sentencesOf(text).length !== 1 ||
      !QUESTION_END.test(text) ||
      hasLongSentence(text) ||
      containsAny(text, config.guidanceNames) ||
      containsAny(text, config.choiceEncouragingWords) ||
      containsAny(text, rules.bannedWords);
    if (invalid) {
      findings.push(gateFinding("FIXED_TEXT_INVALID", "GUIDANCE_QUESTION", target));
    }
    if (item.approval.status !== "APPROVED") {
      findings.push(gateFinding("FIXED_TEXT_NOT_APPROVED", "GUIDANCE_QUESTION", target));
    }
  }

  for (const themeId of new Set(requiredThemes)) {
    for (const scene of GUIDANCE_SCENES) {
      const target = guidanceTarget(themeId, scene);
      if (!seen.has(target)) {
        findings.push(gateFinding("FIXED_TEXT_NOT_APPROVED", "GUIDANCE_QUESTION", target));
      }
    }
  }
  return findings;
}
