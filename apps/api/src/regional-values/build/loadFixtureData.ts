import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  FixedTextsSchema,
  GuidanceQuestionSchema,
  IssueCardSchema,
  QuestionBankSchema,
  ResultTextSchema,
} from "@ehime-vote-navigator/contracts";
import type {
  FixedTexts,
  GuidanceQuestion,
  IssueCard,
  QuestionBank,
  ResultText,
} from "@ehime-vote-navigator/contracts";
import type { Result } from "@ehime-vote-navigator/domain";

/**
 * Reads the fictional data of the repository (`packages/fixtures/src/regional-values/`) by path and
 * checks it with the strict contracts. It does not import `@ehime-vote-navigator/fixtures`: the data is
 * a set of JSON files that the build reads, as the design says.
 *
 * Any problem is `FIXTURE_DATA_UNREADABLE` with the base name of the file and nothing else: no
 * directory, no value, no part of the text.
 */

export const FIXTURE_FILE_NAMES = {
  questionBank: "question-bank.json",
  cards: "cards.json",
  resultTexts: "result-texts.json",
  fixedTexts: "fixed-texts.json",
  guidance: "guidance.json",
} as const;

export type FixtureDataUnreadable = Readonly<{ code: "FIXTURE_DATA_UNREADABLE"; file: string }>;

/** The fictional data, as the parts that the assembly takes. */
export type FixtureData = Readonly<{
  bank: QuestionBank;
  cards: readonly IssueCard[];
  resultTexts: readonly ResultText[];
  fixedTexts: FixedTexts;
  guidance: readonly GuidanceQuestion[];
  /** The text of a fictional source by its ID, for the check of the quotations. */
  sourceTexts: ReadonlyMap<string, string>;
}>;

function unreadable(file: string): Result<never, FixtureDataUnreadable> {
  return { ok: false, error: Object.freeze({ code: "FIXTURE_DATA_UNREADABLE" as const, file }) };
}

async function readJson(directory: string, file: string): Promise<Result<unknown, FixtureDataUnreadable>> {
  try {
    return { ok: true, value: JSON.parse(await readFile(join(directory, file), "utf8")) as unknown };
  } catch {
    return unreadable(file);
  }
}

/** The text of each fictional source: `sources/<id>.json` with a `text`. A source that cannot be read is left out. */
async function readSourceTexts(directory: string, cards: readonly IssueCard[]): Promise<Map<string, string>> {
  const ids = new Set(cards.flatMap((card) => card.sources.map((source) => source.sourceId)));
  const texts = new Map<string, string>();
  for (const id of ids) {
    // The ID becomes a file name, so only a plain name is read: no separator and no relative part.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id)) {
      continue;
    }
    const raw = await readJson(join(directory, "sources"), `${id}.json`);
    if (raw.ok && raw.value !== null && typeof raw.value === "object" && "text" in raw.value && typeof raw.value.text === "string") {
      texts.set(id, raw.value.text);
    }
  }
  return texts;
}

/**
 * Reads and checks the fictional data of `directory`. Every file is read even after the first
 * problem is known, but the first unreadable file is the one that is reported.
 */
export async function loadFixtureData(directory: string): Promise<Result<FixtureData, FixtureDataUnreadable>> {
  const bank = await readJson(directory, FIXTURE_FILE_NAMES.questionBank);
  const cards = await readJson(directory, FIXTURE_FILE_NAMES.cards);
  const resultTexts = await readJson(directory, FIXTURE_FILE_NAMES.resultTexts);
  const fixedTexts = await readJson(directory, FIXTURE_FILE_NAMES.fixedTexts);
  const guidance = await readJson(directory, FIXTURE_FILE_NAMES.guidance);

  if (!bank.ok) return bank;
  if (!cards.ok) return cards;
  if (!resultTexts.ok) return resultTexts;
  if (!fixedTexts.ok) return fixedTexts;
  if (!guidance.ok) return guidance;

  const parsedBank = QuestionBankSchema.safeParse(bank.value);
  if (!parsedBank.success) return unreadable(FIXTURE_FILE_NAMES.questionBank);
  const parsedCards = IssueCardSchema.array().safeParse(cards.value);
  if (!parsedCards.success) return unreadable(FIXTURE_FILE_NAMES.cards);
  const parsedResults = ResultTextSchema.array().safeParse(resultTexts.value);
  if (!parsedResults.success) return unreadable(FIXTURE_FILE_NAMES.resultTexts);
  const parsedFixed = FixedTextsSchema.safeParse(fixedTexts.value);
  if (!parsedFixed.success) return unreadable(FIXTURE_FILE_NAMES.fixedTexts);
  const parsedGuidance = GuidanceQuestionSchema.array().safeParse(guidance.value);
  if (!parsedGuidance.success) return unreadable(FIXTURE_FILE_NAMES.guidance);

  return {
    ok: true,
    value: {
      bank: parsedBank.data,
      cards: parsedCards.data,
      resultTexts: parsedResults.data,
      fixedTexts: parsedFixed.data,
      guidance: parsedGuidance.data,
      sourceTexts: await readSourceTexts(directory, parsedCards.data),
    },
  };
}
