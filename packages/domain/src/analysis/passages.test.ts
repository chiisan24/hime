import { describe, expect, it } from "vitest";

import type { RegisteredCandidate } from "../election/registry.js";
import {
  DEFAULT_MAX_PASSAGE_CHARS,
  attributePassage,
  normalizeForMatch,
  resolveEffectiveCandidate,
  splitIntoPassages,
} from "./passages.js";

const SENTENCE_END = "\u3002";

function stripWhitespace(text: string): string {
  return text.replace(/\s+/gu, "");
}

// Obviously fictional placeholders; no real candidate appears here.
function candidate(candidateId: string, name: string, nameForms: string[] = [name]): RegisteredCandidate {
  return { candidateId, name, nameForms } as unknown as RegisteredCandidate;
}

const CANDIDATES = [
  candidate("candidate-a", "Test Candidate A", ["Test Candidate A", "T. Candidate A"]),
  candidate("candidate-b", "Test Candidate B"),
];

describe("normalizeForMatch", () => {
  it("applies NFKC and removes every kind of whitespace", () => {
    expect(normalizeForMatch("\uFF34\uFF45\uFF53\uFF54\u3000 A\n\tB")).toBe("TestAB");
    expect(normalizeForMatch("  \n ")).toBe("");
  });
});

describe("splitIntoPassages", () => {
  it("returns nothing for empty or blank pages", () => {
    expect(splitIntoPassages([])).toEqual([]);
    expect(splitIntoPassages(["", "  \n\u3000 "])).toEqual([]);
  });

  it("numbers pages from 1 and keeps offsets that slice the original text", () => {
    const pages = [`First sentence${SENTENCE_END}Second sentence${SENTENCE_END}`, "", "  Third page text  "];

    const passages = splitIntoPassages(pages);

    expect(passages.map((p) => [p.page, p.index])).toEqual([[1, 0], [3, 0]]);
    for (const passage of passages) {
      expect(pages[passage.page - 1]?.slice(passage.charStart, passage.charEnd)).toBe(passage.text);
      expect(passage.text).toBe(passage.text.trim());
    }
  });

  it("merges neighbouring sentences up to maxChars and starts a new passage after that", () => {
    const sentence = `abcdefghi${SENTENCE_END}`;
    const page = sentence.repeat(5);

    const passages = splitIntoPassages([page], 25);

    expect(passages.map((p) => p.text)).toEqual([sentence.repeat(2).trim(), sentence.repeat(2).trim(), sentence.trim()]);
    expect(passages.every((p) => p.text.length <= 25)).toBe(true);
  });

  it("cuts an over-long sentence at maxChars", () => {
    const passages = splitIntoPassages(["x".repeat(25)], 10);

    expect(passages.map((p) => p.text.length)).toEqual([10, 10, 5]);
  });

  it("never splits a surrogate pair when cutting", () => {
    const text = "\u{20BB7}".repeat(7);

    const passages = splitIntoPassages([text], 5);

    expect(passages.every((p) => p.text.length % 2 === 0 && p.text.length <= 5)).toBe(true);
    expect(passages.map((p) => p.text).join("")).toBe(text);
  });

  it("starts a new passage at a newline-separated sentence boundary", () => {
    const passages = splitIntoPassages(["line one\nline two\nline three"], 12);

    expect(passages.map((p) => p.text)).toEqual(["line one", "line two", "line three"]);
  });

  it("neither adds nor drops non-whitespace characters, and never crosses a page", () => {
    const pages = ["A1\uFF01B2\uFF1FC3\nD4 E5", "F6" + SENTENCE_END + "G7".repeat(30), "H8"];

    const passages = splitIntoPassages(pages, 8);

    for (const [index, pageText] of pages.entries()) {
      const joined = passages.filter((p) => p.page === index + 1).map((p) => p.text).join("");
      expect(stripWhitespace(joined)).toBe(stripWhitespace(pageText));
    }
  });

  it("is deterministic", () => {
    const pages = [`a${SENTENCE_END}b${SENTENCE_END}c`.repeat(40)];

    expect(splitIntoPassages(pages, 50)).toEqual(splitIntoPassages(pages, 50));
  });

  it("uses a default of 1000 and rejects an invalid limit", () => {
    expect(DEFAULT_MAX_PASSAGE_CHARS).toBe(1000);
    expect(splitIntoPassages(["y".repeat(2500)]).map((p) => p.text.length)).toEqual([1000, 1000, 500]);
    for (const bad of [0, 1, -5, 2.5, Number.NaN]) {
      expect(() => splitIntoPassages(["text"], bad)).toThrow(RangeError);
    }
  });
});

describe("attributePassage", () => {
  it("assigns a passage that names exactly one candidate, with its evidence", () => {
    const result = attributePassage("The plan of Test Candidate A is described here.", 3, CANDIDATES);

    expect(result).toEqual({
      assignment: { state: "ASSIGNED", candidateId: "candidate-a" },
      evidence: { nameForm: "Test Candidate A", page: 3 },
    });
  });

  it("matches a registered alternative spelling and reports that spelling", () => {
    const result = attributePassage("Statement by T. Candidate A.", 1, CANDIDATES);

    expect(result.assignment).toEqual({ state: "ASSIGNED", candidateId: "candidate-a" });
    expect(result.evidence?.nameForm).toBe("T. Candidate A");
  });

  it("ignores whitespace and width differences inside the name", () => {
    const result = attributePassage("Test\u3000Candidate\nB says", 2, CANDIDATES);

    expect(result.assignment).toEqual({ state: "ASSIGNED", candidateId: "candidate-b" });
  });

  it("counts several mentions of one candidate as one candidate", () => {
    const result = attributePassage("Test Candidate A ... Test Candidate A ... T. Candidate A", 1, CANDIDATES);

    expect(result.assignment.state).toBe("ASSIGNED");
  });

  it("leaves a passage without any registered name unassigned", () => {
    expect(attributePassage("No names here at all.", 1, CANDIDATES)).toEqual({
      assignment: { state: "UNASSIGNED" },
      evidence: null,
    });
  });

  it("leaves a passage naming two candidates unassigned", () => {
    expect(attributePassage("Test Candidate A and Test Candidate B", 1, CANDIDATES).assignment).toEqual({ state: "UNASSIGNED" });
  });

  it("is safe when one registered name contains another", () => {
    const overlapping = [candidate("short", "Smith"), candidate("long", "John Smith")];

    expect(attributePassage("John Smith wrote this", 1, overlapping).assignment).toEqual({ state: "UNASSIGNED" });
    expect(attributePassage("Only Smith wrote this", 1, overlapping).assignment).toEqual({ state: "ASSIGNED", candidateId: "short" });
  });

  it("ignores empty name forms and works without candidates", () => {
    expect(attributePassage("anything", 1, [candidate("blank", "  ", [" "])]).assignment.state).toBe("UNASSIGNED");
    expect(attributePassage("anything", 1, []).assignment.state).toBe("UNASSIGNED");
  });
});

describe("resolveEffectiveCandidate", () => {
  it.each([
    [{ state: "ASSIGNED", candidateId: "c1" }, { state: "UNASSIGNED" }, "c1"],
    [{ state: "ASSIGNED", candidateId: "c1" }, { state: "SHARED" }, "c1"],
    [{ state: "ASSIGNED", candidateId: "c1" }, { state: "ASSIGNED", candidateId: "c1" }, "c1"],
    [{ state: "ASSIGNED", candidateId: "c1" }, { state: "ASSIGNED", candidateId: "c2" }, null],
    [{ state: "UNASSIGNED" }, { state: "ASSIGNED", candidateId: "c2" }, "c2"],
    [{ state: "UNASSIGNED" }, { state: "SHARED" }, null],
    [{ state: "UNASSIGNED" }, { state: "UNASSIGNED" }, null],
  ] as const)("passage %j in document %j gives %j", (passage, document, expected) => {
    expect(resolveEffectiveCandidate(passage, document)).toBe(expected);
  });
});