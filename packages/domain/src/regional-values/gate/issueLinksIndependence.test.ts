import {
  AnswersSchema,
  IssueCardSchema,
  MapInputSchema,
  MapQuestionSchema,
  QuestionSchema,
} from "@ehime-vote-navigator/contracts";
import type { IssueCard, MapInput, MapQuestion, Question } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

// The record of links is not a field of a question, a card or the input of the map (Req 13.7, Property 63).
// The first lines are checked by the compiler (`@ts-expect-error` fails when the line is not an error);
// the others are checked by the contracts, which are strict.

const LINK_FIELDS = [{ issueId: "issue-1" }, { issueVersion: 1 }, { issueLinks: [] }, { links: [] }] as const;

describe("the record of links does not reach the public contracts or the calculation of the map", () => {
  it("is not a field of a question, of a card, of a question of the map or of the input of the map (checked by the compiler)", () => {
    const question = {} as Question;
    const card = {} as IssueCard;
    const mapQuestion = {} as MapQuestion;
    const mapInput = {} as MapInput;
    // @ts-expect-error a question has no field for the issue that it rests on
    const withIssue: Question = { ...question, issueId: "issue-1" };
    // @ts-expect-error a card has no field for the issue that it rests on
    const cardWithIssue: IssueCard = { ...card, issueVersion: 1 };
    // @ts-expect-error a question of the map has no field for the issue that it rests on
    const mapQuestionWithIssue: MapQuestion = { ...mapQuestion, issueId: "issue-1" };
    // @ts-expect-error the input of the map has no field for the record of links
    const mapInputWithLinks: MapInput = { ...mapInput, issueLinks: [] };
    expect([withIssue, cardWithIssue, mapQuestionWithIssue, mapInputWithLinks]).toHaveLength(4);
  });

  it("is refused by the strict contracts of the question, the card, the question of the map and the input of the map", () => {
    const base = {
      question: { questionId: "q", kind: "IMPORTANCE" },
      card: { dataKind: "FIXTURE", cardId: "c" },
      mapQuestion: { questionId: "q" },
      mapInput: { setKind: "QUICK" },
    };
    // A value that has the extra field is refused whether or not the rest is valid: the extra field is a reason of its own.
    for (const extra of LINK_FIELDS) {
      for (const [schema, value] of [
        [QuestionSchema, base.question],
        [IssueCardSchema, base.card],
        [MapQuestionSchema, base.mapQuestion],
        [MapInputSchema, base.mapInput],
      ] as const) {
        const result = schema.safeParse({ ...value, ...extra });
        expect(result.success).toBe(false);
        if (!result.success) {
          const key = Object.keys(extra)[0] ?? "";
          expect(JSON.stringify(result.error.issues)).toContain(key);
        }
      }
    }
    expect(AnswersSchema.safeParse({ issueId: "issue-1" }).success).toBe(false);
  });
});
