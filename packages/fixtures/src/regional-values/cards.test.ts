import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { IssueCardSchema, type IssueCard } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

const DIRECTORY = new URL("./", import.meta.url);
const CARDS_PATH = fileURLToPath(new URL("./cards.json", DIRECTORY));

function cards(): IssueCard[] {
  return IssueCardSchema.array().parse(JSON.parse(readFileSync(CARDS_PATH, "utf8")) as unknown);
}

function sourceText(sourceId: string): string {
  const path = fileURLToPath(new URL(`./sources/${sourceId}.json`, DIRECTORY));
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (value === null || typeof value !== "object" || !("text" in value) || typeof value.text !== "string") {
    throw new Error(`The fictional source ${sourceId} needs text`);
  }
  return value.text;
}

const QUICK_THEMES = ["POPULATION_REVITALIZATION", "DISASTER_PREVENTION", "EDUCATION_CHILDCARE"] as const;
const REAL_NAMES = ["愛媛県", "松山市", "今治市", "自由民主党", "立憲民主党"] as const;

describe("regional values FIXTURE issue cards", () => {
  it("are strict, schema-valid FIXTURE cards", () => {
    const values = cards();
    expect(values).toHaveLength(3);
    expect(values.every((card) => card.dataKind === "FIXTURE")).toBe(true);
    expect(values.every((card) => card.sources.every((source) => source.dataKind === "FIXTURE"))).toBe(true);
    expect(values.every((card) => card.facts.every((fact) => fact.dataKind === "FIXTURE"))).toBe(true);
  });

  it("has one approved card for each provisional QUICK theme", () => {
    const values = cards();
    expect(values.map((card) => card.themeId).sort()).toEqual([...QUICK_THEMES].sort());
    for (const themeId of QUICK_THEMES) {
      expect(values.some((card) => card.themeId === themeId && card.approval.status === "APPROVED")).toBe(true);
    }
  });

  it("uses fictional sources only: no URL, publisher, catalog, or real data field", () => {
    for (const card of cards()) {
      for (const source of card.sources) {
        expect(source).toEqual({ dataKind: "FIXTURE", sourceId: source.sourceId });
      }
      for (const fact of card.facts) {
        expect(Object.keys(fact).sort()).toEqual([
          "area",
          "dataKind",
          "factId",
          "fictionalSourceId",
          "sentence",
          "surveyDate",
          "value",
        ]);
      }
    }
  });

  it("makes every card visibly fictional and contains none of the test list of real names", () => {
    for (const card of cards()) {
      expect(card.background).toContain("架空");
      const allText = JSON.stringify(card);
      for (const name of REAL_NAMES) {
        expect(allText).not.toContain(name);
      }
    }
  });

  it("has a quotation that occurs in the text of its fictional source", () => {
    for (const card of cards()) {
      const sourceIds = card.sources.map((source) => source.sourceId);
      expect(sourceIds).toContain(card.quote.sourceId);
      expect(sourceText(card.quote.sourceId)).toContain(card.quote.text);
    }
  });

  it("keeps the fictional source IDs of the facts within the card sources", () => {
    for (const card of cards()) {
      if (card.dataKind !== "FIXTURE") {
        throw new Error("The fixture card must be FIXTURE");
      }
      const sourceIds = new Set(card.sources.map((source) => source.sourceId));
      for (const fact of card.facts) {
        if (fact.dataKind !== "FIXTURE") {
          throw new Error("The fixture fact must be FIXTURE");
        }
        expect(sourceIds.has(fact.fictionalSourceId)).toBe(true);
      }
    }
  });
});