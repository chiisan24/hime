// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import "../../../../../tests/harness/react-renderer.js";
import { DEMO_DILEMMAS } from "./demoDilemmas.js";
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

    // 4枚の状態カードは出さない。レーダーは計算と未接続のため値を出さない
    for (const name of ["判断に迷ったテーマ", "回答しなかったテーマ", "判定できない項目", "未出題のテーマ"]) {
      expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
    }
    const radar = screen.getByRole("region", { name: "価値観レーダー" });
    expect(radar).toHaveTextContent("準備中");
    expect(within(radar).queryByRole("img")).not.toBeInTheDocument();
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
