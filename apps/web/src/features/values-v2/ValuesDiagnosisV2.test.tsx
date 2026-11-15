// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import "../../../../../tests/harness/react-renderer.js";
import { DEMO_DILEMMAS, UI_VALUE_AXES } from "./demoDilemmas.js";
import type { DilemmaAnswers, UiAxisAnalyzer, UiAxisDisplayValue } from "./uiTypes.js";
import { ValuesDiagnosisV2 } from "./ValuesDiagnosisV2.js";

/*
 * 地域課題ジレンマ診断（v2）の主な操作の確認。
 */

beforeAll(() => {
  window.scrollTo = () => undefined;
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function heading() {
  return screen.getByRole("heading", { level: 1 });
}

function progress() {
  return screen.getByText(/6問中/u);
}

function nextButton() {
  return screen.getByRole("button", { name: /次の質問へ|結果を見る/u });
}

function radios() {
  return screen.getAllByRole("radio") as HTMLInputElement[];
}

function choose(labelStart: string) {
  fireEvent.click(screen.getByRole("radio", { name: new RegExp(`^${labelStart}：`, "u") }));
}

function start() {
  render(<ValuesDiagnosisV2 />);
  fireEvent.click(screen.getByRole("button", { name: /診断をはじめる/u }));
}

/** 6問に順に答える。"skip" はスキップ、それ以外は5段階の表示名 */
function answerAll(plan: readonly string[]) {
  for (const step of plan) {
    if (step === "skip") {
      fireEvent.click(screen.getByRole("button", { name: "スキップ" }));
    } else {
      choose(step);
      fireEvent.click(nextButton());
    }
  }
}

function mapItem(questionId: string): HTMLElement {
  const item = document.querySelector<HTMLElement>(`[data-question-id='${questionId}']`);
  if (item === null) {
    throw new Error(`missing map item ${questionId}`);
  }
  return item;
}

describe("ValuesDiagnosisV2（地域課題ジレンマ診断）", () => {
  it("開始画面に問数とデモ用の架空データの表示を出す", () => {
    render(<ValuesDiagnosisV2 />);
    expect(heading()).toHaveTextContent("地域課題ジレンマ診断");
    expect(screen.getByText("6問・約2分")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("デモ用の架空データです");
  });

  it("6問をテーマ定義順に1問ずつ表示し、A・Bと5段階を出す", () => {
    start();
    DEMO_DILEMMAS.forEach((question, index) => {
      expect(progress()).toHaveTextContent(`6問中 ${index + 1}問目`);
      expect(heading()).toHaveTextContent(question.situation);
      expect(screen.getByText(question.optionA.text, { selector: "li span" })).toBeInTheDocument();
      expect(screen.getByText(question.optionB.text, { selector: "li span" })).toBeInTheDocument();
      expect(radios()).toHaveLength(5);
      choose("Aをやや重視");
      fireEvent.click(nextButton());
    });
    expect(heading()).toHaveTextContent("あなたの地域課題マップ");
  });

  it("初期状態は未回答で、中央の「同程度」も選ばれておらず、未回答では次へ進まない", () => {
    start();
    expect(radios().every((radio) => !radio.checked)).toBe(true);
    expect(screen.getByRole("radio", { name: /^同程度：/u })).not.toBeChecked();
    expect(nextButton()).toHaveAttribute("aria-disabled", "true");
    expect(nextButton()).toHaveAccessibleDescription("5段階から選ぶか、スキップしてください");
    fireEvent.click(nextButton());
    expect(progress()).toHaveTextContent("6問中 1問目");
    expect(screen.getByRole("button", { name: /前の質問へ/u })).toBeDisabled();
  });

  it("スキップすると次へ進み、戻ると未選択のまま「スキップしました」と出て、あとから回答できる", () => {
    start();
    fireEvent.click(screen.getByRole("button", { name: "スキップ" }));
    expect(progress()).toHaveTextContent("6問中 2問目");

    fireEvent.click(screen.getByRole("button", { name: /前の質問へ/u }));
    expect(progress()).toHaveTextContent("6問中 1問目");
    expect(screen.getByRole("status")).toHaveTextContent("この質問はスキップしました");
    // スキップは中立（同程度）にしない
    expect(radios().every((radio) => !radio.checked)).toBe(true);
    // スキップ済みなので次へ進める
    expect(nextButton()).not.toHaveAttribute("aria-disabled");

    choose("Bを強く重視");
    expect(screen.getByRole("radio", { name: /^Bを強く重視：/u })).toBeChecked();
    expect(screen.queryByText(/この質問はスキップしました/u)).not.toBeInTheDocument();
  });

  it("前の質問に戻ると回答が残り、別の選択肢で回答を変更できる", () => {
    start();
    choose("Aを強く重視");
    fireEvent.click(nextButton());
    fireEvent.click(screen.getByRole("button", { name: /前の質問へ/u }));
    expect(screen.getByRole("radio", { name: /^Aを強く重視：/u })).toBeChecked();
    choose("同程度");
    expect(screen.getByRole("radio", { name: /^同程度：/u })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Aを強く重視：/u })).not.toBeChecked();
  });

  it("地域課題マップに回答の位置を出し、スキップは「回答なし」として0点に変えない", () => {
    start();
    const plan = ["Aを強く重視", "skip", "同程度", "Bをやや重視", "Aをやや重視", "Bを強く重視"];
    for (const step of plan) {
      if (step === "skip") {
        fireEvent.click(screen.getByRole("button", { name: "スキップ" }));
      } else {
        choose(step);
        fireEvent.click(nextButton());
      }
    }

    expect(heading()).toHaveTextContent("あなたの地域課題マップ");
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("6問中5問に回答しました（スキップ 1問）");

    const [transport, education, economy, healthcare] = DEMO_DILEMMAS;
    if (transport === undefined || education === undefined || economy === undefined || healthcare === undefined) {
      throw new Error("demo data is incomplete");
    }
    expect(mapItem(transport.questionId)).toHaveAttribute("data-position", "0");
    expect(mapItem(transport.questionId)).toHaveTextContent("「Aを強く重視」を選びました。");
    expect(mapItem(economy.questionId)).toHaveAttribute("data-position", "2");
    expect(mapItem(healthcare.questionId)).toHaveAttribute("data-position", "3");

    const skipped = mapItem(education.questionId);
    expect(skipped).toHaveAttribute("data-answer", "SKIPPED");
    expect(skipped).toHaveAttribute("data-position", "none");
    expect(skipped).toHaveTextContent("スキップしました（回答なし）。");
    expect(skipped).not.toHaveTextContent("同程度");

    // 4枚の状態カードは出さない
    for (const name of ["判断に迷ったテーマ", "回答しなかったテーマ", "判定できない項目", "未出題のテーマ"]) {
      expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
    }
    // レーダーは、計算方法が未確定のため回答から値を出さない。以前は図を出さずに「準備中」とだけ示していた。
    // 利用者の指示で図を出すようにしたため、図は見本の値のサンプル表示で、分析結果ではないと示すことを確かめる
    //（サンプルが回答によって変わらないことは、下の別のテストで確かめる）
    const radar = screen.getByRole("region", { name: "価値観レーダー" });
    expect(radar).toHaveTextContent("準備中");
    expect(radar).toHaveTextContent("あなたの回答から計算した結果ではありません");
    expect(within(radar).getByRole("img")).toHaveAccessibleName(/^サンプル表示の価値観レーダー/u);
    expect(radar.querySelector("figure")).toHaveAttribute("data-radar-mode", "sample");
    expect(document.body).not.toHaveTextContent(/一致率|ランキング|[0-9０-９]+位/u);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("結果画面から1つの質問に答え直すと、その質問に戻り、ほかの回答は残る", () => {
    start();
    for (let index = 0; index < 6; index += 1) {
      choose("Aをやや重視");
      fireEvent.click(nextButton());
    }
    const [, , economy] = DEMO_DILEMMAS;
    if (economy === undefined) {
      throw new Error("demo data is incomplete");
    }
    fireEvent.click(within(mapItem(economy.questionId)).getByRole("button", { name: /この質問に答え直す/u }));
    expect(progress()).toHaveTextContent("6問中 3問目");
    expect(screen.getByRole("radio", { name: /^Aをやや重視：/u })).toBeChecked();
    choose("Bをやや重視");
    for (let index = 3; index <= 6; index += 1) {
      fireEvent.click(nextButton());
    }
    expect(mapItem(economy.questionId)).toHaveAttribute("data-position", "3");
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("6問中6問に回答しました");
  });

  it("結果画面は、見出し → 価値観レーダー → 6つの考え方 → 回答の振り返り → 操作の順に並ぶ", () => {
    start();
    answerAll(["Aを強く重視", "Aをやや重視", "同程度", "Bをやや重視", "Bを強く重視", "Aをやや重視"]);

    const headings = screen
      .getAllByRole("heading")
      .filter((element) => (element.tagName === "H1" || element.tagName === "H2") && element.closest("dialog") === null)
      .map((element) => element.textContent);
    expect(headings).toEqual([
      "あなたの地域課題マップ",
      "価値観レーダー",
      "6つの考え方（価値観の軸）",
      "地域課題ごとの回答の振り返り",
    ]);
    const review = screen.getByRole("region", { name: "地域課題ごとの回答の振り返り" });
    for (const name of [/回答を見直す/u, /最初からやり直す/u]) {
      const button = screen.getByRole("button", { name });
      expect(review.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // 回答の振り返りは6問すべてを残す
    expect(within(review).getAllByRole("button", { name: /この質問に答え直す/u })).toHaveLength(6);
  });

  it("6つの考え方に、軸ごとの2つの質問（A側とB側）と回答を出し、スキップは0点にせず「回答なし」と出す", () => {
    start();
    answerAll(["Aを強く重視", "skip", "同程度", "Bをやや重視", "Aをやや重視", "Bを強く重視"]);

    const section = screen.getByRole("region", { name: "6つの考え方（価値観の軸）" });
    expect(within(section).getByText(/AとBに優劣はありません/u)).toBeInTheDocument();
    for (const axis of UI_VALUE_AXES) {
      const item = section.querySelector<HTMLElement>(`[data-axis-trace='${axis.axisId}']`);
      expect(item, axis.axisId).not.toBeNull();
      expect(item).toHaveTextContent(axis.definition);
      const links = Array.from(item?.querySelectorAll<HTMLElement>("[data-trace-question]") ?? []);
      expect(links.map((link) => link.dataset.traceSide).sort()).toEqual(["A", "B"]);
      for (const link of links) {
        const question = DEMO_DILEMMAS.find((candidate) => candidate.questionId === link.dataset.traceQuestion);
        const option = link.dataset.traceSide === "A" ? question?.optionA : question?.optionB;
        expect(option?.valueAxisId).toBe(axis.axisId);
        expect(link).toHaveTextContent(option?.text ?? "");
      }
    }

    const [transport, education] = DEMO_DILEMMAS;
    if (transport === undefined || education === undefined) {
      throw new Error("demo data is incomplete");
    }
    const fairnessOnTransport = section.querySelector(
      `[data-axis-trace='FAIRNESS'] [data-trace-question='${transport.questionId}']`,
    );
    expect(fairnessOnTransport).toHaveTextContent("地域交通（考え方A）");
    expect(fairnessOnTransport).toHaveTextContent("あなたの回答：Aを強く重視");
    // スキップした教育・子育ては、関係する2つの軸のどちらでも「回答なし」。「同程度」や0点にしない
    const skipped = Array.from(section.querySelectorAll(`[data-trace-question='${education.questionId}']`));
    expect(skipped).toHaveLength(2);
    for (const link of skipped) {
      expect(link).toHaveAttribute("data-trace-answer", "SKIPPED");
      expect(link).toHaveTextContent("あなたの回答：スキップ（回答なし）");
      expect(link).not.toHaveTextContent("同程度");
    }
    // 回答の振り返りの A・B にも、対応する軸を出す
    expect(mapItem(transport.questionId)).toHaveTextContent("軸：公平性");
    expect(mapItem(transport.questionId)).toHaveTextContent("軸：暮らしの安定");
  });

  it("計算方法が未確定のあいだのレーダーは、回答によって変わらないサンプル表示になる", () => {
    const radarShapeAfter = (plan: readonly string[]) => {
      const { unmount } = render(<ValuesDiagnosisV2 />);
      fireEvent.click(screen.getByRole("button", { name: /診断をはじめる/u }));
      answerAll(plan);
      const radar = screen.getByRole("region", { name: "価値観レーダー" });
      const figure = radar.querySelector("figure");
      const shape = {
        mode: figure?.getAttribute("data-radar-mode"),
        polygons: Array.from(figure?.querySelectorAll("polygon") ?? []).map((polygon) =>
          polygon.getAttribute("points"),
        ),
        dots: Array.from(figure?.querySelectorAll("circle") ?? []).map((circle) => circle.getAttribute("data-axis")),
        texts: Array.from(figure?.querySelectorAll("li") ?? []).map((item) => item.textContent),
      };
      expect(shape.polygons.length).toBeGreaterThan(0);
      unmount();
      return shape;
    };

    const allA = radarShapeAfter(["Aを強く重視", "Aを強く重視", "Aを強く重視", "Aを強く重視", "Aを強く重視", "Aを強く重視"]);
    const mixed = radarShapeAfter(["Bを強く重視", "skip", "同程度", "skip", "Bをやや重視", "Aをやや重視"]);
    expect(allA.mode).toBe("sample");
    expect(mixed).toEqual(allA);
  });

  it("分析の関数を差し替えると、その値でレーダーを描き、答え直すと図が変わり、スキップは変えずに渡す", () => {
    // テスト専用の分析（正式な計算ではない）: 各軸がA側に出る質問の回答だけを見て、仮の水準にする
    const received: DilemmaAnswers[] = [];
    const TEST_LEVELS = { A_STRONG: 2, A_LEAN: 1, BALANCED: 0, B_LEAN: -1, B_STRONG: -2 } as const;
    const testAnalyzer: UiAxisAnalyzer = ({ questions, axes, answers }) => {
      received.push(answers);
      return {
        status: "ANALYZED",
        values: axes.map((axis): UiAxisDisplayValue => {
          const question = questions.find((candidate) => candidate.optionA.valueAxisId === axis.axisId);
          const answer = question === undefined ? undefined : answers[question.questionId];
          return answer === undefined || answer === "SKIPPED"
            ? { axisId: axis.axisId, state: "UNDETERMINED" }
            : { axisId: axis.axisId, state: "DETERMINED", level: TEST_LEVELS[answer], usableQuestions: 1 };
        }),
      };
    };

    render(<ValuesDiagnosisV2 analyzeAxes={testAnalyzer} />);
    fireEvent.click(screen.getByRole("button", { name: /診断をはじめる/u }));
    answerAll(["Aを強く重視", "skip", "Aを強く重視", "Aを強く重視", "Aを強く重視", "Aを強く重視"]);

    const radar = () => screen.getByRole("region", { name: "価値観レーダー" });
    expect(radar().querySelector("figure")).toHaveAttribute("data-radar-mode", "analysis");
    expect(radar()).not.toHaveTextContent(/サンプル|見本/u);
    expect(within(radar()).getByRole("img")).toHaveAccessibleName(/^価値観レーダー/u);
    // 教育・子育て（暮らしの安定がA側）はスキップ。その軸は点を置かず、点線と「分析できません」にする
    const [transport, education] = DEMO_DILEMMAS;
    if (transport === undefined || education === undefined) {
      throw new Error("demo data is incomplete");
    }
    expect(received.at(-1)?.[education.questionId]).toBe("SKIPPED");
    expect(radar().querySelector("figure circle[data-axis='STABILITY']")).toBeNull();
    // 見出しのアイコンの円を数えないよう、図（figure）の中だけを数える
    expect(radar().querySelectorAll("figure circle")).toHaveLength(5);
    expect(radar().querySelector("[data-axis-description='STABILITY']")).toHaveTextContent("分析できません");
    const before = Array.from(radar().querySelectorAll("polygon[data-result]")).map((polygon) =>
      polygon.getAttribute("points"),
    );

    // 地域交通（公平性がA側）を答え直すと、図が変わる
    fireEvent.click(within(mapItem(transport.questionId)).getByRole("button", { name: /この質問に答え直す/u }));
    choose("Bを強く重視");
    for (let index = 1; index <= 6; index += 1) {
      fireEvent.click(nextButton());
    }
    expect(heading()).toHaveTextContent("あなたの地域課題マップ");
    expect(received.at(-1)?.[transport.questionId]).toBe("B_STRONG");
    const after = Array.from(radar().querySelectorAll("polygon[data-result]")).map((polygon) =>
      polygon.getAttribute("points"),
    );
    expect(after).not.toEqual(before);
    expect(radar().querySelector("[data-axis-description='FAIRNESS']")).toHaveTextContent(
      "もう一方の考え方を選ぶことが多かった",
    );
  });

  it("キーボードで操作できる部品（ネイティブのボタンとラジオ）だけで作り、結果画面では見出しにフォーカスを移す", () => {
    start();
    // 5段階は、同じ name のネイティブのラジオボタン（矢印キーで選べる）
    expect(new Set(radios().map((radio) => radio.name)).size).toBe(1);
    expect(radios().every((radio) => radio.type === "radio" && radio.tabIndex !== -1)).toBe(true);
    answerAll(["Aを強く重視", "skip", "同程度", "Bをやや重視", "Aをやや重視", "Bを強く重視"]);

    expect(document.activeElement).toBe(heading());
    // 結果画面の操作は、すべてネイティブの button で、Tab で移れる（6問の答え直し、見直し、やり直し）
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(8);
    for (const button of buttons) {
      expect(button.tagName).toBe("BUTTON");
      expect(button).not.toHaveAttribute("tabindex", "-1");
      expect(button).toBeEnabled();
    }
    // レーダーの図は操作の対象ではない（Tab で止まらない）
    const radar = screen.getByRole("region", { name: "価値観レーダー" });
    expect(radar.querySelectorAll("[tabindex]")).toHaveLength(0);
  });

  it("最初からやり直すと、確認のあと回答を消して1問目に戻る", () => {
    start();
    for (let index = 0; index < 6; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "スキップ" }));
    }
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("6問中0問に回答しました（スキップ 6問）");
    fireEvent.click(screen.getByRole("button", { name: /最初からやり直す/u }));
    fireEvent.click(screen.getByRole("button", { name: "回答を消して最初から" }));
    expect(progress()).toHaveTextContent("6問中 1問目");
    expect(screen.queryByText(/この質問はスキップしました/u)).not.toBeInTheDocument();
    expect(radios().every((radio) => !radio.checked)).toBe(true);
  });
});
