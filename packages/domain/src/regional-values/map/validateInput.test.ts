import type { MapInput } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { GOLDEN_VECTORS } from "../../../../../tests/harness/regional-values/goldenVectors.js";
import {
  ED,
  PICK_ID,
  TB_FULL,
  TB_QUICK,
  TR,
  importanceId,
  mapInput,
  tradeoffId,
} from "../../../../../tests/harness/regional-values/testBanks.js";
import { levelOf } from "./rounding.js";
import { validateMapInput } from "./validateInput.js";

function clone(input: MapInput): MapInput {
  return JSON.parse(JSON.stringify(input));
}

const quick = (answers: Record<string, unknown>, thresholds = { t1: 50, t2: 150 }): MapInput =>
  mapInput(TB_QUICK, "QUICK", answers, thresholds);
const full = (answers: Record<string, unknown>): MapInput => mapInput(TB_FULL, "FULL", answers);

const OPINION = { [importanceId(ED)]: "IMPORTANT" };

describe("validateMapInput: the golden error vectors", () => {
  const errorVectors = GOLDEN_VECTORS.filter(
    (vector) => !vector.expected.ok && /^(V03|V12|V13|V17)/u.test(vector.id),
  );

  it("has the vectors of V03, V12, V13 and V17", () => {
    expect(errorVectors.length).toBe(1 + 4 + 7 + 2);
  });

  it.each(errorVectors.map((vector): [string, MapInput, unknown] => [vector.id, vector.input, vector.expected]))(
    "%s",
    (_id, input, expected) => {
      const result = validateMapInput(input);
      expect(result.ok).toBe(false);
      expect(result.ok ? undefined : { ok: false, error: result.error }).toEqual(expected);
    },
  );
});

describe("validateMapInput: error priority", () => {
  const badThresholds = { t1: 0, t2: 150 };
  const faults = { ...OPINION, "not-a-question": "IMPORTANT", [tradeoffId(ED)]: "MAYBE" };

  it("reports INVALID_CONFIG before UNKNOWN_QUESTION and INVALID_ANSWER", () => {
    expect(validateMapInput(quick(faults, badThresholds))).toEqual({
      ok: false,
      error: { code: "INVALID_CONFIG" },
    });
  });

  it("reports UNKNOWN_QUESTION before INVALID_ANSWER", () => {
    expect(validateMapInput(quick(faults))).toEqual({
      ok: false,
      error: { code: "UNKNOWN_QUESTION", questionIds: ["not-a-question"] },
    });
  });

  it("reports INVALID_ANSWER before NO_OPINION_ANSWERS", () => {
    const answers = { [importanceId(ED)]: "UNSURE", [tradeoffId(ED)]: "MAYBE" };
    expect(validateMapInput(quick(answers))).toEqual({
      ok: false,
      error: { code: "INVALID_ANSWER", questionIds: [tradeoffId(ED)] },
    });
  });

  it("reports NO_OPINION_ANSWERS last, for non-opinion answers and for no answer at all", () => {
    expect(validateMapInput(quick({ [importanceId(ED)]: "DECLINE" }))).toEqual({
      ok: false,
      error: { code: "NO_OPINION_ANSWERS" },
    });
    expect(validateMapInput(quick({}))).toEqual({ ok: false, error: { code: "NO_OPINION_ANSWERS" } });
  });

  it("returns every offending ID, sorted, whatever the order of the answers", () => {
    const forward = { ...OPINION, zz: "IMPORTANT", aa: "IMPORTANT", mm: "IMPORTANT" };
    const backward = { mm: "IMPORTANT", aa: "IMPORTANT", zz: "IMPORTANT", ...OPINION };
    const expected = { ok: false, error: { code: "UNKNOWN_QUESTION", questionIds: ["aa", "mm", "zz"] } };
    expect(validateMapInput(quick(forward))).toEqual(expected);
    expect(validateMapInput(quick(backward))).toEqual(expected);

    const invalidForward = { [importanceId(ED)]: "X", [tradeoffId(ED)]: "Y" };
    const invalidBackward = { [tradeoffId(ED)]: "Y", [importanceId(ED)]: "X" };
    const expectedInvalid = {
      ok: false,
      error: { code: "INVALID_ANSWER", questionIds: [importanceId(ED), tradeoffId(ED)] },
    };
    expect(validateMapInput(quick(invalidForward))).toEqual(expectedInvalid);
    expect(validateMapInput(quick(invalidBackward))).toEqual(expectedInvalid);
  });
});

describe("validateMapInput: thresholds (V13)", () => {
  it.each([
    [1, 2],
    [100, 200],
    [50, 150],
    [199, 200],
  ])("accepts (%i, %i)", (t1, t2) => {
    expect(validateMapInput(quick(OPINION, { t1, t2 })).ok).toBe(true);
  });

  it("accepts exactly the pairs that levelOf accepts", () => {
    const candidates: number[] = [
      -1, 0, 1, 2, 50, 99, 100, 149, 150, 151, 199, 200, 201, 0.5, 50.5, Number.NaN,
      Number.POSITIVE_INFINITY,
    ];
    const mismatches: number[][] = [];
    for (const t1 of candidates) {
      for (const t2 of candidates) {
        const validates = validateMapInput(quick(OPINION, { t1, t2 })).ok;
        let levelOfAccepts = true;
        try {
          levelOf(0, t1, t2);
        } catch {
          levelOfAccepts = false;
        }
        if (validates !== levelOfAccepts) {
          mismatches.push([t1, t2]);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("validateMapInput: the diagnostic set and its questions (INVALID_CONFIG)", () => {
  it("rejects a set kind that the bank does not have", () => {
    expect(validateMapInput(mapInput(TB_QUICK, "FULL", OPINION))).toEqual({
      ok: false,
      error: { code: "INVALID_CONFIG" },
    });
  });

  it("rejects a set that lists a question the bank does not have", () => {
    const input = clone(quick(OPINION));
    input.bank.sets[0]?.questionIds.push("ghost");
    expect(validateMapInput(input).ok).toBe(false);
  });

  it.each([0, -1, 2.5, Number.MAX_SAFE_INTEGER + 1])("rejects a question weight of %s", (weight) => {
    const input = clone(quick(OPINION));
    const question = input.bank.questions[0];
    if (question !== undefined) {
      question.weight = weight;
    }
    expect(validateMapInput(input)).toEqual({ ok: false, error: { code: "INVALID_CONFIG" } });
  });

  it("accepts a weight above 3 (the schema limit is not this function's concern)", () => {
    const input = clone(quick(OPINION));
    const question = input.bank.questions[0];
    if (question !== undefined) {
      question.weight = 12;
    }
    expect(validateMapInput(input).ok).toBe(true);
  });

  it("rejects two priority-theme questions in one set", () => {
    const input = clone(full({ [importanceId(TR)]: "IMPORTANT" }));
    input.bank.questions.push({ questionId: "q-pick-2", kind: "PRIORITY_PICK", themeId: null, weight: 1 });
    input.bank.sets[0]?.questionIds.push("q-pick-2");
    expect(validateMapInput(input)).toEqual({ ok: false, error: { code: "INVALID_CONFIG" } });
  });

  it("rejects an importance question with no theme", () => {
    const input = clone(quick(OPINION));
    const question = input.bank.questions[0];
    if (question !== undefined) {
      question.themeId = null;
    }
    expect(validateMapInput(input)).toEqual({ ok: false, error: { code: "INVALID_CONFIG" } });
  });

  it("does not look at questions that are not in the set", () => {
    const input = clone(mapInput(TB_FULL, "QUICK", OPINION));
    const outside = input.bank.questions.find((question) => question.questionId === importanceId(TR));
    if (outside !== undefined) {
      outside.weight = 0;
    }
    expect(validateMapInput(input).ok).toBe(true);
  });
});

describe("validateMapInput: answer values (INVALID_ANSWER)", () => {
  const invalidPicks: [string, unknown][] = [
    ["a repeated theme", { pick: [TR, TR] }],
    ["three themes", { pick: [TR, ED, "ECONOMY_EMPLOYMENT"] }],
    ["a theme that is not in the bank", { pick: ["NOT_A_THEME"] }],
    ["no theme", { pick: [] }],
    ["an extra key", { pick: [TR], extra: 1 }],
    ["a bare array", [TR]],
    ["a bare theme ID", TR],
    ["a number", 3],
    ["null", null],
  ];

  it.each(invalidPicks)("rejects the priority answer %s", (_name, pick) => {
    expect(validateMapInput(full({ [importanceId(TR)]: "IMPORTANT", [PICK_ID]: pick }))).toEqual({
      ok: false,
      error: { code: "INVALID_ANSWER", questionIds: [PICK_ID] },
    });
  });

  it("accepts one or two themes, in any order, and a non-opinion code, for the priority question", () => {
    for (const pick of [{ pick: [TR] }, { pick: [ED, TR] }, "UNSURE", "DECLINE", "UNANSWERED"]) {
      expect(validateMapInput(full({ [importanceId(TR)]: "IMPORTANT", [PICK_ID]: pick })).ok).toBe(true);
    }
  });

  it("keeps the code families apart", () => {
    const wrong: [string, string, unknown][] = [
      ["importance", importanceId(TR), "A_STRONG"],
      ["importance", importanceId(TR), { pick: [TR] }],
      ["trade-off", tradeoffId(TR), "VERY_IMPORTANT"],
      ["trade-off", tradeoffId(TR), { pick: [TR] }],
      ["priority", PICK_ID, "IMPORTANT"],
      ["priority", PICK_ID, "BALANCED"],
    ];
    for (const [, questionId, value] of wrong) {
      const result = validateMapInput(full({ [importanceId(ED)]: "IMPORTANT", [questionId]: value }));
      expect(result).toEqual({ ok: false, error: { code: "INVALID_ANSWER", questionIds: [questionId] } });
    }
  });

  it("accepts a non-opinion code for every question kind", () => {
    for (const code of ["UNSURE", "DECLINE", "UNANSWERED"]) {
      const answers = {
        [importanceId(ED)]: "IMPORTANT",
        [importanceId(TR)]: code,
        [tradeoffId(TR)]: code,
        [PICK_ID]: code,
      };
      expect(validateMapInput(full(answers)).ok).toBe(true);
    }
  });

  it("rejects an explicit undefined and a lower-case code", () => {
    expect(validateMapInput(quick({ ...OPINION, [tradeoffId(ED)]: undefined })).ok).toBe(false);
    expect(validateMapInput(quick({ [importanceId(ED)]: "important" })).ok).toBe(false);
  });
});

describe("validateMapInput: keys of the answers", () => {
  it("looks at own keys only", () => {
    const inherited = Object.create({ "not-a-question": "IMPORTANT" });
    Object.assign(inherited, OPINION);
    expect(validateMapInput(quick(inherited)).ok).toBe(true);
  });

  it.each(["__proto__", "toString", "constructor", ""])("treats the own key %j as an unknown question", (key) => {
    const answers: Record<string, unknown> = { ...OPINION };
    Object.defineProperty(answers, key, { value: "IMPORTANT", enumerable: true, configurable: true, writable: true });
    expect(validateMapInput(quick(answers))).toEqual({
      ok: false,
      error: { code: "UNKNOWN_QUESTION", questionIds: [key] },
    });
  });
});

describe("validateMapInput: the validated input", () => {
  it("lists the questions of the set in the bank's definition order, with the answers in calculation form", () => {
    const result = validateMapInput(
      full({ [importanceId(ED)]: "NOT_VERY_IMPORTANT", [tradeoffId(ED)]: "A_LEAN", [tradeoffId(TR)]: "UNSURE", [PICK_ID]: { pick: [ED] } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.questions.map((row) => row.question.questionId)).toEqual(
      TB_FULL.questions.map((question) => question.questionId),
    );
    const byId = new Map(result.value.questions.map((row) => [row.question.questionId, row.answer]));
    expect(byId.get(importanceId(ED))).toEqual({ kind: "OPINION", value: -1 });
    expect(byId.get(tradeoffId(ED))).toEqual({ kind: "OPINION", value: 1 });
    expect(byId.get(tradeoffId(TR))).toEqual({ kind: "NON_OPINION", reason: "UNSURE" });
    expect(byId.get(importanceId(TR))).toEqual({ kind: "NON_OPINION", reason: "UNANSWERED" });
    expect(byId.get(PICK_ID)).toEqual({ kind: "PICK", themeIds: [ED] });
    expect(result.value.thresholds).toEqual({ t1: 50, t2: 150 });
  });

  it("does not change a frozen input", () => {
    const input = clone(full({ [importanceId(ED)]: "IMPORTANT", [PICK_ID]: { pick: [ED] } }));
    const before = JSON.stringify(input);
    const freeze = (value: unknown): void => {
      if (typeof value === "object" && value !== null) {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    };
    freeze(input);
    expect(validateMapInput(input).ok).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });
});