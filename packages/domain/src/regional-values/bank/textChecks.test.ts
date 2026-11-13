import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  QuestionBankSchema,
  type NeutralityConfig,
  type Question,
  type QuestionBank,
} from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import {
  ASCII_NAME,
  FULLWIDTH_ASCII_NAME,
  PREMISE_60,
  PREMISE_61,
  STANDARD_PREMISE,
  TEST_FACT_NUMERALS,
  TEST_NEUTRALITY_CONFIG,
  TEXT_CHECK_ORDER,
  TEXT_INJECTION_CASES,
  buildPassingBank,
  eligibleQuestionIndexes,
  expectedTextViolations,
  injectTextViolation,
} from "../../../../../tests/harness/regional-values/bankInjection.js";
import { TEXT_CHECK_IDS, checkQuestionTexts, type TextCheckViolation } from "./textChecks.js";

type TradeoffQuestion = Extract<Question, { kind: "TRADEOFF" }>;
type ImportanceQuestion = Extract<Question, { kind: "IMPORTANCE" }>;

const CONFIG = TEST_NEUTRALITY_CONFIG;
const BANK = buildPassingBank();

function run(bank: QuestionBank, config: NeutralityConfig = CONFIG, facts: ReadonlySet<string> = TEST_FACT_NUMERALS) {
  return checkQuestionTexts(bank, config, facts);
}

function firstTradeoff(): TradeoffQuestion {
  const found = BANK.questions.find((question) => question.kind === "TRADEOFF");
  if (found?.kind !== "TRADEOFF") {
    throw new Error("The passing bank has a trade-off question");
  }
  return found;
}

function firstImportance(): ImportanceQuestion {
  const found = BANK.questions.find((question) => question.kind === "IMPORTANCE");
  if (found?.kind !== "IMPORTANCE") {
    throw new Error("The passing bank has an importance question");
  }
  return found;
}

/** The bank with one question replaced. */
function replace(question: Question): QuestionBank {
  return {
    ...BANK,
    questions: BANK.questions.map((candidate) => (candidate.questionId === question.questionId ? question : candidate)),
  };
}

function only(check: TextCheckViolation["check"], question: Question): TextCheckViolation[] {
  return [{ check, questionId: question.questionId }];
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

describe("the passing bank and the settings", () => {
  it("passes every text check", () => {
    expect(run(BANK)).toEqual([]);
  });

  it("satisfies the question bank contract, so that the checks run on valid data", () => {
    expect(QuestionBankSchema.safeParse(BANK).success).toBe(true);
  });

  it("accepts the wording of the fixture bank under the test settings", () => {
    const path = fileURLToPath(new URL("../../../../fixtures/src/regional-values/question-bank.json", import.meta.url));
    const fixture = QuestionBankSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
    expect(run(fixture, CONFIG, new Set())).toEqual([]);
  });

  it("lists the checks in the order that the harness expects", () => {
    expect([...TEXT_CHECK_IDS]).toEqual([...TEXT_CHECK_ORDER]);
  });
});

describe("NAME_FREE (Req 3.3)", () => {
  const importance = firstImportance();

  it("rejects each candidate name, party name and incumbency word", () => {
    for (const word of [...CONFIG.candidateAndPartyNames, ...CONFIG.incumbencyWords]) {
      const changed = replace({ ...importance, explanation: `${importance.explanation}${word}` });
      expect(run(changed), word).toEqual(only("NAME_FREE", importance));
    }
  });

  it("rejects a name in the question text, the explanation, the premise and a direction", () => {
    const tradeoff = firstTradeoff();
    const name = CONFIG.candidateAndPartyNames[0] ?? "";
    expect(name).not.toBe("");
    const cases: TradeoffQuestion[] = [
      { ...tradeoff, text: tradeoff.text + name },
      { ...tradeoff, explanation: tradeoff.explanation + name },
      { ...tradeoff, directionA: { ...tradeoff.directionA, text: tradeoff.directionA.text + name } },
      { ...tradeoff, directionB: { ...tradeoff.directionB, text: tradeoff.directionB.text + name } },
    ];
    for (const changed of cases) {
      expect(run(replace(changed))).toEqual(only("NAME_FREE", tradeoff));
    }
    // A premise must be in the template list, so the name is tested through a list that contains it.
    const premise = STANDARD_PREMISE + name;
    const withListedPremise = { ...CONFIG, premiseTemplates: [STANDARD_PREMISE, premise] };
    expect(run(replace({ ...tradeoff, premise }), withListedPremise)).toEqual(only("NAME_FREE", tradeoff));
  });

  it("does not tell the half-width and the full-width spelling apart", () => {
    const changed = replace({ ...importance, explanation: importance.explanation + FULLWIDTH_ASCII_NAME });
    expect(CONFIG.candidateAndPartyNames).toContain(ASCII_NAME);
    expect(run(changed)).toEqual(only("NAME_FREE", importance));
  });

  it("accepts a bank when the lists are empty", () => {
    const empty = { ...CONFIG, candidateAndPartyNames: [], incumbencyWords: [] };
    const changed = replace({ ...importance, explanation: `${importance.explanation}現職` });
    expect(run(changed, empty)).toEqual([]);
  });
});

describe("SINGLE_ISSUE (Req 3.4)", () => {
  const tradeoff = firstTradeoff();

  it("accepts one sentence, with or without an end mark", () => {
    expect(run(replace({ ...tradeoff, text: "防災について、どちらを先に進めたいですか？" }))).toEqual([]);
    expect(run(replace({ ...tradeoff, text: "防災について、どちらを先に進めたいですか" }))).toEqual([]);
  });

  it("rejects two sentences divided by 。 ？ ！ or a line break", () => {
    for (const mark of ["。", "？", "！", "\n"]) {
      const changed = replace({ ...tradeoff, text: `防災についてたずねます${mark}どちらを先に進めたいですか` });
      expect(run(changed), JSON.stringify(mark)).toEqual(only("SINGLE_ISSUE", tradeoff));
    }
  });

  it("rejects each double-question word", () => {
    for (const word of CONFIG.doubleQuestionWords) {
      const changed = replace({ ...tradeoff, text: `防災と交通を${word}進めたいですか` });
      expect(run(changed), word).toEqual(only("SINGLE_ISSUE", tradeoff));
    }
  });

  it("rejects an empty question text, which has no sentence", () => {
    expect(run(replace({ ...tradeoff, text: "。" }))).toEqual(only("SINGLE_ISSUE", tradeoff));
  });

  it("reads only the question text, not the explanation", () => {
    const changed = replace({ ...tradeoff, explanation: `${tradeoff.explanation}かつ、続きの文です。` });
    expect(run(changed)).toEqual([]);
  });
});

describe("LOADED_TERMS (Req 3.5)", () => {
  it("rejects each loaded word in the text, the explanation and a direction", () => {
    const tradeoff = firstTradeoff();
    for (const word of CONFIG.loadedWords) {
      const cases: TradeoffQuestion[] = [
        { ...tradeoff, text: tradeoff.text + word },
        { ...tradeoff, explanation: tradeoff.explanation + word },
        { ...tradeoff, directionB: { ...tradeoff.directionB, text: tradeoff.directionB.text + word } },
      ];
      for (const changed of cases) {
        expect(run(replace(changed)), word).toEqual(only("LOADED_TERMS", tradeoff));
      }
    }
  });

  it("rejects a loaded word in the explanation of a priority pick question", () => {
    const pick = BANK.questions.find((question) => question.kind === "PRIORITY_PICK");
    expect(pick).toBeDefined();
    if (pick === undefined) {
      return;
    }
    expect(run(replace({ ...pick, explanation: `${pick.explanation}推奨語` }))).toEqual(only("LOADED_TERMS", pick));
  });

  it("accepts a bank when the loaded words do not appear", () => {
    expect(run(BANK, { ...CONFIG, loadedWords: ["現れない語"] })).toEqual([]);
  });
});

describe("IMPORTANCE_PATTERN (Req 3.13)", () => {
  const importance = firstImportance();

  it("accepts the form with the name of its own theme", () => {
    expect(run(BANK).filter((violation) => violation.check === "IMPORTANCE_PATTERN")).toEqual([]);
  });

  it("rejects a text that is not the form", () => {
    for (const text of ["あなたは暮らしをどう考えますか", `${importance.text}。`, importance.text.replace("は、", "は")]) {
      expect(run(replace({ ...importance, text })), text).toContainEqual({
        check: "IMPORTANCE_PATTERN",
        questionId: importance.questionId,
      });
    }
  });

  it("rejects the form with the name of another theme", () => {
    const text = CONFIG.importanceTemplate.replace("{テーマ名}", "交通と防災");
    expect(run(replace({ ...importance, text }))).toEqual(only("IMPORTANCE_PATTERN", importance));
  });

  it("rejects a policy name, a budget stance word and a number in the question", () => {
    for (const word of [...CONFIG.policyNames, ...CONFIG.budgetStanceWords, "37", "３７", "三", "2024年", "令和6年"]) {
      const result = run(replace({ ...importance, text: importance.text + word }));
      expect(result, word).toContainEqual({ check: "IMPORTANCE_PATTERN", questionId: importance.questionId });
    }
  });

  it("rejects a policy name that the form itself contains", () => {
    const config = { ...CONFIG, policyNames: ["暮らし"] };
    expect(run(BANK, config).map((violation) => violation.check)).toContain("IMPORTANCE_PATTERN");
  });

  it("reads only importance questions", () => {
    const tradeoff = firstTradeoff();
    expect(run(replace({ ...tradeoff, text: "あなたは何を先に進めたいですか" }))).toEqual([]);
  });

  it("takes a theme label that contains a replacement pattern as plain text", () => {
    const label = "A$&B";
    const relabelled: QuestionBank = {
      ...replace({ ...importance, text: CONFIG.importanceTemplate.replace("{テーマ名}", () => label) }),
      themes: BANK.themes.map((theme) => (theme.themeId === importance.themeId ? { ...theme, label } : theme)),
    };
    expect(run(relabelled)).toEqual([]);
  });
});

describe("PREMISE (Req 3.14)", () => {
  const tradeoff = firstTradeoff();

  it("accepts the template and a template of exactly 60 characters", () => {
    expect(Array.from(PREMISE_60)).toHaveLength(60);
    expect(run(replace({ ...tradeoff, premise: STANDARD_PREMISE }))).toEqual([]);
    expect(run(replace({ ...tradeoff, premise: PREMISE_60 }))).toEqual([]);
  });

  it("rejects a template of 61 characters, although the list contains it", () => {
    expect(Array.from(PREMISE_61)).toHaveLength(61);
    expect(CONFIG.premiseTemplates).toContain(PREMISE_61);
    expect(run(replace({ ...tradeoff, premise: PREMISE_61 }))).toEqual(only("PREMISE", tradeoff));
  });

  it("rejects a premise that is not in the template list", () => {
    for (const premise of ["どちらかを選ぶ場面を考えてください", `${STANDARD_PREMISE}！`]) {
      expect(run(replace({ ...tradeoff, premise })), premise).toEqual(only("PREMISE", tradeoff));
    }
  });

  it("rejects a listed premise of two sentences", () => {
    const premise = "限られた条件があります。どちらかを選んでください";
    const config = { ...CONFIG, premiseTemplates: [STANDARD_PREMISE, premise] };
    expect(run(replace({ ...tradeoff, premise }), config)).toEqual(only("PREMISE", tradeoff));
  });

  it("counts the length without the surrounding white space", () => {
    const padded = `  ${PREMISE_60}  `;
    const config = { ...CONFIG, premiseTemplates: [STANDARD_PREMISE, padded] };
    expect(run(replace({ ...tradeoff, premise: padded }), config)).toEqual([]);
  });
});

describe("POSITIVE_FRAMING (Req 3.15)", () => {
  const tradeoff = firstTradeoff();

  it("rejects each negation word in direction A and in direction B", () => {
    for (const word of CONFIG.negationWords) {
      const inA = { ...tradeoff, directionA: { ...tradeoff.directionA, text: tradeoff.directionA.text + word } };
      const inB = { ...tradeoff, directionB: { ...tradeoff.directionB, text: tradeoff.directionB.text + word } };
      expect(run(replace(inA)), word).toEqual(only("POSITIVE_FRAMING", tradeoff));
      expect(run(replace(inB)), word).toEqual(only("POSITIVE_FRAMING", tradeoff));
    }
  });

  it("rejects a negation word in a listed premise", () => {
    const premise = `${STANDARD_PREMISE}しない`;
    const config = { ...CONFIG, premiseTemplates: [STANDARD_PREMISE, premise] };
    expect(run(replace({ ...tradeoff, premise }), config)).toEqual(only("POSITIVE_FRAMING", tradeoff));
  });

  it("does not read the question text or the explanation", () => {
    const changed = replace({ ...tradeoff, text: `${tradeoff.text}しない`, explanation: `${tradeoff.explanation}しない` });
    expect(run(changed)).toEqual([]);
  });
});

describe("NON_EXCLUSIVE (Req 3.16)", () => {
  const tradeoff = firstTradeoff();

  it("accepts the balanced label", () => {
    expect(tradeoff.opinionLabels[2]).toBe("どちらも同じくらい大切");
    expect(run(BANK).filter((violation) => violation.check === "NON_EXCLUSIVE")).toEqual([]);
  });

  it("rejects any other balanced label", () => {
    for (const label of ["どちらでもない", "どちらも同じくらい大切です", ""]) {
      const changed = replace({ ...tradeoff, opinionLabels: ["a", "b", label, "d", "e"] });
      expect(run(changed), label).toEqual(only("NON_EXCLUSIVE", tradeoff));
    }
  });

  it("rejects each exclusive word in a label and in a direction", () => {
    for (const word of CONFIG.exclusiveWords) {
      const [first, second, third, fourth, fifth] = tradeoff.opinionLabels;
      const inLabel = replace({ ...tradeoff, opinionLabels: [first + word, second, third, fourth, fifth] });
      const inDirection = replace({
        ...tradeoff,
        directionA: { ...tradeoff.directionA, text: tradeoff.directionA.text + word },
      });
      expect(run(inLabel), word).toEqual(only("NON_EXCLUSIVE", tradeoff));
      expect(run(inDirection), word).toEqual(only("NON_EXCLUSIVE", tradeoff));
    }
  });
});

describe("NO_FACT_NUMBERS (Req 3.17)", () => {
  const tradeoff = firstTradeoff();

  function withDirection(suffix: string): QuestionBank {
    return replace({ ...tradeoff, directionA: { ...tradeoff.directionA, text: tradeoff.directionA.text + suffix } });
  }

  it("rejects a number or a year of the fact items in half-width, full-width and year forms", () => {
    for (const spelling of ["12", "１２", "2020", "2020年", "２０２０年", "令和6年", "令和６年", "一"]) {
      expect(run(withDirection(spelling)), spelling).toEqual(only("NO_FACT_NUMBERS", tradeoff));
    }
  });

  it("accepts a number that the fact items do not contain", () => {
    for (const spelling of ["37", "３７", "2019年", "十二", "120"]) {
      expect(run(withDirection(spelling)), spelling).toEqual([]);
    }
  });

  it("does not count a kanji numeral inside an exempt word", () => {
    expect(run(withDirection("一方"))).toEqual([]);
    expect(run(withDirection("一方、万全、一方"))).toEqual([]);
    expect(run(withDirection("一方、一"))).toEqual(only("NO_FACT_NUMBERS", tradeoff));
  });

  it("accepts every number when the fact items have none", () => {
    expect(run(withDirection("12"), CONFIG, new Set())).toEqual([]);
  });

  it("reads trade-off questions only", () => {
    const importance = firstImportance();
    expect(run(replace({ ...importance, explanation: `${importance.explanation}12` }))).toEqual([]);
  });

  it("does not join the digits of two different sentences into one number", () => {
    const changed = replace({
      ...tradeoff,
      directionA: { ...tradeoff.directionA, text: `${tradeoff.directionA.text}1` },
      directionB: { ...tradeoff.directionB, text: `2${tradeoff.directionB.text}` },
    });
    expect(run(changed, CONFIG, new Set(["12", "21"]))).toEqual([]);
  });
});

describe("the result of a run", () => {
  it("lists the violations by check definition and then by bank definition", () => {
    const nameCase = TEXT_INJECTION_CASES.findIndex((c) => c.name.startsWith("a candidate name"));
    const loadedCase = TEXT_INJECTION_CASES.findIndex((c) => c.name.startsWith("a loaded word"));
    // Bank order: question 0 is the first importance question, 1 and 5 are trade-off questions.
    const injections = [
      { caseIndex: loadedCase, questionIndex: 0, a: 0, b: 0 },
      { caseIndex: nameCase, questionIndex: 5, a: 0, b: 0 },
      { caseIndex: nameCase, questionIndex: 1, a: 1, b: 0 },
    ];
    const injected = injections.reduce((bank, injection) => injectTextViolation(bank, injection), BANK);
    const result = run(injected);
    expect(result).toEqual(expectedTextViolations(BANK, injections));
    expect(result.map((violation) => violation.check)).toEqual(["NAME_FREE", "NAME_FREE", "LOADED_TERMS"]);
    expect(result.map((violation) => violation.questionId)).toEqual([
      BANK.questions[1]?.questionId,
      BANK.questions[5]?.questionId,
      BANK.questions[0]?.questionId,
    ]);
  });

  it("reports each check at most once per question", () => {
    const importance = firstImportance();
    const changed = replace({ ...importance, explanation: `${importance.explanation}現職試験候補甲` });
    expect(run(changed)).toEqual(only("NAME_FREE", importance));
  });

  it("reports an injected violation in every question that it can be applied to, one at a time", () => {
    for (const [caseIndex, injectionCase] of TEXT_INJECTION_CASES.entries()) {
      const indexes = eligibleQuestionIndexes(BANK, caseIndex);
      expect(indexes.length, injectionCase.name).toBeGreaterThan(0);
      for (const questionIndex of indexes) {
        for (const a of [0, 1, 2, 3, 4, 5, 6, 7]) {
          for (const b of [0, 1, 2, 3]) {
            const injection = { caseIndex, questionIndex, a, b };
            expect(run(injectTextViolation(BANK, injection)), `${injectionCase.name} / ${questionIndex} / ${a} / ${b}`).toEqual(
              expectedTextViolations(BANK, [injection]),
            );
          }
        }
      }
    }
  });

  it("does not change the bank, the settings or the fact numbers, and gives the same result again", () => {
    const injected = injectTextViolation(BANK, { caseIndex: 0, questionIndex: 0, a: 0, b: 0 });
    const before = structuredClone(injected);
    const frozenBank = deepFreeze(structuredClone(injected));
    const frozenConfig = deepFreeze(structuredClone(CONFIG));
    const frozenFacts: ReadonlySet<string> = new Set(TEST_FACT_NUMERALS);
    const first = checkQuestionTexts(frozenBank, frozenConfig, frozenFacts);
    const second = checkQuestionTexts(frozenBank, frozenConfig, frozenFacts);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(frozenBank).toEqual(before);
    expect(frozenFacts).toEqual(TEST_FACT_NUMERALS);
  });
});
