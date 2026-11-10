import type { CandidateId } from "@ehime-vote-navigator/contracts";

import type { RegisteredCandidate } from "../election/registry.js";

/** Passages never exceed this many UTF-16 code units unless a caller asks otherwise. */
export const DEFAULT_MAX_PASSAGE_CHARS = 1000;

// Sentence ends: newline, the ideographic full stop, and full-width ! and ?.
const SENTENCE_END = new Set(["\n", "\u3002", "\uFF01", "\uFF1F"]);

/** A passage located inside one page by UTF-16 offsets: text === page.slice(charStart, charEnd). */
export type RawPassage = Readonly<{
  page: number;
  index: number;
  charStart: number;
  charEnd: number;
  text: string;
}>;

type Range = Readonly<{ start: number; end: number }>;

/** Search form of a text: Unicode NFKC with every whitespace character removed. */
export function normalizeForMatch(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, "");
}

function sentenceRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let start = 0;
  for (let position = 0; position < text.length; position += 1) {
    if (SENTENCE_END.has(text.charAt(position))) {
      ranges.push({ start, end: position + 1 });
      start = position + 1;
    }
  }
  if (start < text.length) {
    ranges.push({ start, end: text.length });
  }
  return ranges;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function cutRange(text: string, range: Range, maxChars: number): Range[] {
  const pieces: Range[] = [];
  let position = range.start;
  while (position < range.end) {
    let cut = Math.min(position + maxChars, range.end);
    if (cut < range.end && isHighSurrogate(text.charCodeAt(cut - 1))) {
      cut -= 1;
    }
    pieces.push({ start: position, end: cut });
    position = cut;
  }
  return pieces;
}

function mergeRanges(text: string, fragments: readonly Range[], maxChars: number): Range[] {
  const merged: Range[] = [];
  let current: Range | undefined;

  for (const fragment of fragments) {
    if (fragment.end - fragment.start > maxChars) {
      if (current !== undefined) {
        merged.push(current);
        current = undefined;
      }
      merged.push(...cutRange(text, fragment, maxChars));
    } else if (current === undefined) {
      current = fragment;
    } else if (fragment.end - current.start <= maxChars) {
      current = { start: current.start, end: fragment.end };
    } else {
      merged.push(current);
      current = fragment;
    }
  }

  if (current !== undefined) {
    merged.push(current);
  }
  return merged;
}

function trimRange(text: string, range: Range): Range | undefined {
  const slice = text.slice(range.start, range.end);
  const leading = slice.length - slice.trimStart().length;
  const trailing = slice.length - slice.trimEnd().length;
  if (leading + trailing >= slice.length) {
    return undefined;
  }
  return { start: range.start + leading, end: range.end - trailing };
}

/**
 * Splits page texts (index 0 is page 1) into passages. Deterministic rule:
 * cut after each newline or sentence end, merge neighbouring pieces greedily up
 * to `maxChars`, cut an over-long piece at `maxChars` (never inside a surrogate
 * pair), trim blank edges, and drop blank passages. A passage never spans two
 * pages and no non-whitespace character is added or dropped.
 */
export function splitIntoPassages(
  pages: readonly string[],
  maxChars: number = DEFAULT_MAX_PASSAGE_CHARS,
): RawPassage[] {
  if (!Number.isInteger(maxChars) || maxChars < 2) {
    throw new RangeError("maxChars must be an integer of at least 2");
  }

  const passages: RawPassage[] = [];
  pages.forEach((pageText, pageIndex) => {
    const merged = mergeRanges(pageText, sentenceRanges(pageText), maxChars);
    let index = 0;
    for (const range of merged) {
      const trimmed = trimRange(pageText, range);
      if (trimmed === undefined) {
        continue;
      }
      passages.push({
        page: pageIndex + 1,
        index,
        charStart: trimmed.start,
        charEnd: trimmed.end,
        text: pageText.slice(trimmed.start, trimmed.end),
      });
      index += 1;
    }
  });
  return passages;
}

export type PassageAttribution = Readonly<{
  assignment:
    | Readonly<{ state: "ASSIGNED"; candidateId: CandidateId }>
    | Readonly<{ state: "UNASSIGNED" }>;
  evidence: Readonly<{ nameForm: string; page: number }> | null;
}>;

/**
 * Ties a passage to a candidate only when exactly one registered candidate is
 * named in it. Only the registered `name` and `nameForms` are matched, after
 * NFKC normalization and whitespace removal on both sides; there is no fuzzy
 * matching. Zero or several candidates leave the passage UNASSIGNED.
 */
export function attributePassage(
  text: string,
  page: number,
  candidates: readonly RegisteredCandidate[],
): PassageAttribution {
  const normalizedText = normalizeForMatch(text);
  const matches: Array<{ candidateId: CandidateId; nameForm: string }> = [];

  for (const candidate of candidates) {
    const hit = [candidate.name, ...candidate.nameForms].find((form) => {
      const normalizedForm = normalizeForMatch(form);
      return normalizedForm.length > 0 && normalizedText.includes(normalizedForm);
    });
    if (hit !== undefined) {
      matches.push({ candidateId: candidate.candidateId, nameForm: hit });
    }
  }

  const only = matches[0];
  if (matches.length === 1 && only !== undefined) {
    return {
      assignment: { state: "ASSIGNED", candidateId: only.candidateId },
      evidence: { nameForm: only.nameForm, page },
    };
  }
  return { assignment: { state: "UNASSIGNED" }, evidence: null };
}

type PassageAssignmentLike =
  | Readonly<{ state: "ASSIGNED"; candidateId: string }>
  | Readonly<{ state: "UNASSIGNED" }>;
type DocumentAssignmentLike =
  | Readonly<{ state: "ASSIGNED"; candidateId: string }>
  | Readonly<{ state: "SHARED" }>
  | Readonly<{ state: "UNASSIGNED" }>;

/**
 * The candidate a passage may be attributed to downstream, or null.
 * A passage tied to one candidate keeps it unless the document is explicitly
 * assigned to a different candidate (a conflict, so nobody). An unassigned
 * passage inherits the document candidate only when the document is ASSIGNED.
 */
export function resolveEffectiveCandidate(
  passage: PassageAssignmentLike,
  document: DocumentAssignmentLike,
): string | null {
  if (passage.state === "ASSIGNED") {
    return document.state === "ASSIGNED" && document.candidateId !== passage.candidateId
      ? null
      : passage.candidateId;
  }
  return document.state === "ASSIGNED" ? document.candidateId : null;
}