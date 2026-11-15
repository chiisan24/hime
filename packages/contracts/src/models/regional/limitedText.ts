import { z } from "zod";

import { NonEmptyStringSchema } from "../primitives.js";

/**
 * Text metrics of the issue discovery contracts (draft.ts, dataset.ts, issues.ts). They follow the
 * rules of core.ts and content.ts: a length counts Unicode code points after trimming surrounding
 * whitespace, and a sentence ends at 。 ？ ！ or a line break.
 *
 * This file is not exported by `index.ts`, so the barrel does not gain these generic names.
 */

export function codePointCount(value: string): number {
  return Array.from(value).length;
}

export function sentencesOf(text: string): string[] {
  return text.split(/[。？！\r\n]/u).filter((sentence) => sentence.trim() !== "");
}

/** Text of `min` to `max` code points after trimming. */
export function limitedText(min: number, max: number) {
  return NonEmptyStringSchema.refine((value) => {
    const length = codePointCount(value.trim());
    return length >= min && length <= max;
  }, `Must contain ${min} to ${max} Unicode code points after trimming surrounding whitespace`);
}

/** Text of `min` to `max` code points that is exactly one sentence. */
export function oneSentence(min: number, max: number) {
  return limitedText(min, max).refine((value) => sentencesOf(value).length === 1, "Must be one sentence");
}

/** An array whose items are all different (compared as strings). */
export function distinctStrings<T extends z.ZodType<string>>(item: T) {
  return z.array(item).refine((items) => new Set(items).size === items.length, "Must not list an item twice");
}
