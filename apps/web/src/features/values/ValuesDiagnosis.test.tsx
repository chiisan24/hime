// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import "../../../../../tests/harness/react-renderer.js";
import { ValuesDiagnosis } from "./ValuesDiagnosis.js";

/*
 * 価値観診断の主な操作（クイック版6問、大切さ・優先条件の回答、戻る・回答の変更、
 * わからない・回答しない、結果画面の4つの状態の区別）を確かめる。
 */

beforeAll(() => {
  // jsdom は window.scrollTo を実装していないため、何もしない関数に置き換える
  window.scrollTo = () => undefined;
  // jsdom は <dialog> の showModal / close を実装していないため、最小限の代わりを置く
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

function nextButton() {
  return screen.getByRole("button", { name: /次の質問へ|結果を見る/u });
}

function choose(label: string) {
  fireEvent.click(screen.getByRole("radio", { name: label }));
}

function startDiagnosis() {
  render(<ValuesDiagnosis />);
  fireEvent.click(screen.getByRole("button", { name: /診断をはじめる/u }));
}

describe("ValuesDiagnosis（価値観診断）", () => {
  it("開始画面に、診断セットの問数（6問）と扱うテーマ数、デモ用の架空データの表示を出す", () => {
    render(<ValuesDiagnosis />);
    expect(heading()).toHaveTextContent("価値観マップ");
    expect(screen.getAllByText(/6問/u).length).toBeGreaterThan(0);
    expect(screen.getByText("3つのテーマ")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("デモ用の架空データです");
  });

  it("1問ずつ出題し、問番号と全問数を出し、未選択では次の質問へ進まない", () => {
    startDiagnosis();
    expect(screen.getByText(/6問中/u)).toHaveTextContent("6問中 1問目");
    expect(heading()).toHaveTextContent("教育・子育ては、あなたの暮らしにとってどのくらい大切ですか？");
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    expect(screen.getByRole("button", { name: /前の質問へ/u })).toBeDisabled();

    expect(nextButton()).toHaveAttribute("aria-disabled", "true");
    // 次の質問へのボタンの近くに、選ぶよう促す文を出す（Req 2.8）
    expect(nextButton()).toHaveAccessibleDescription("回答を1つ選んでください");
    fireEvent.click(nextButton());
    expect(screen.getByText(/6問中/u)).toHaveTextContent("6問中 1問目");
  });

  it("大切さ質問と優先条件質問で回答の選択肢を切り替え、戻ると前の回答が選ばれている", () => {
    startDiagnosis();
    choose("大切");
    expect(screen.getByRole("radio", { name: "大切" })).toBeChecked();
    fireEvent.click(nextButton());

    // 2問目：優先条件質問（前提文、方向A・B、方向の5段階）
    expect(screen.getByText(/6問中/u)).toHaveTextContent("6問中 2問目");
    expect(screen.getByText(/限られた予算や人手の中で/u)).toBeInTheDocument();
    expect(screen.getByText("方向A：")).toBeInTheDocument();
    expect(screen.getByText("方向B：")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "どちらも同じくらい大切" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "とても大切" })).not.toBeInTheDocument();
    choose("どちらかといえばB");

    fireEvent.click(screen.getByRole("button", { name: /前の質問へ/u }));
    expect(screen.getByText(/6問中/u)).toHaveTextContent("6問中 1問目");
    expect(screen.getByRole("radio", { name: "大切" })).toBeChecked();

    // 回答の変更：別の選択肢で置き換える
    choose("とても大切");
    expect(screen.getByRole("radio", { name: "とても大切" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "大切" })).not.toBeChecked();
    fireEvent.click(nextButton());
    expect(screen.getByRole("radio", { name: "どちらかといえばB" })).toBeChecked();
  });

  it("6問に答えると結果画面を出し、大切さと優先条件を別の欄に、4つの状態を別の欄に出す", () => {
    startDiagnosis();
    const answers = [
      "とても大切",
      "どちらかといえばB",
      "わからない",
      "Aに近い",
      "大切",
      "回答しない",
    ];
    answers.forEach((label, index) => {
      expect(screen.getByText(/6問中/u)).toHaveTextContent(`6問中 ${index + 1}問目`);
      choose(label);
      fireEvent.click(nextButton());
    });

    expect(heading()).toHaveTextContent("あなたの価値観マップ");
    // デモ用の固定結果であることを明示する
    expect(screen.getAllByText("デモ用の固定結果").length).toBeGreaterThan(0);
    expect(screen.getByText(/あなたの回答から計算したものではありません/u)).toBeInTheDocument();
    // 注意書き
    expect(screen.getByText(/投票先の推奨ではありません/u)).toBeInTheDocument();

    // クイック版では最優先テーマを聞いていない
    const priority = screen.getByRole("region", { name: "最優先テーマ" });
    expect(priority).toHaveTextContent("この診断では最優先テーマを聞いていません");

    // 大切さ：5段階の見出しがすべて出る（段階のグループ）
    const importance = screen.getByRole("region", { name: "大切さ" });
    for (const level of ["とても大切", "大切", "どちらともいえない", "あまり大切でない", "大切でない"]) {
      expect(within(importance).getByRole("heading", { name: level })).toBeInTheDocument();
    }
    // 優先条件：大切さとは別の欄。条件付きの表現と、大切さの併記
    const tradeoff = screen.getByRole("region", { name: "優先条件" });
    expect(tradeoff).toHaveTextContent("両立が難しい場面で");
    expect(tradeoff).toHaveTextContent(/どちらかを選ぶなら、防災では.+（強く）/u);
    expect(tradeoff).toHaveTextContent("大切さ：判定できません");

    // 4つの状態は別の文言と別の欄
    expect(screen.getByRole("region", { name: "判断に迷ったテーマ" })).toHaveTextContent("防災");
    const declined = screen.getByRole("region", { name: "回答しなかったテーマ" });
    expect(within(declined).getByRole("heading", { name: "回答しない" })).toBeInTheDocument();
    expect(within(declined).getByRole("heading", { name: "未回答" })).toBeInTheDocument();
    const notAsked = screen.getByRole("region", { name: "未出題のテーマ" });
    expect(notAsked).toHaveTextContent("地域交通");
    expect(notAsked).toHaveTextContent("出題していません");
    expect(screen.getByRole("region", { name: "判定できない項目" })).toHaveTextContent(
      "大切さ：判定できません",
    );

    // 件数は「n / m」
    expect(screen.getByRole("region", { name: "結果のもとになった数" })).toHaveTextContent("3 / 6");

    // 回答の振り返りは、利用者の実際の回答
    const reflection = screen.getByRole("region", { name: "回答の振り返り（あなたの実際の回答）" });
    expect(reflection).toHaveTextContent("あなたの回答：とても大切");
    expect(reflection).toHaveTextContent("あなたの回答：わからない");
    expect(reflection).toHaveTextContent("あなたの回答：回答しない");

    // 活かし方は「選挙」「移住や就職」「日常生活」
    const guidance = screen.getByRole("region", { name: "この結果の活かし方" });
    expect(guidance).toHaveTextContent("選挙で");
    expect(guidance).toHaveTextContent("移住や就職で");
    expect(guidance).toHaveTextContent("日常生活で");

    // 順位・一致率を表示しない。レーダーチャートは出さない
    expect(document.body).not.toHaveTextContent(/[0-9０-９]+位|ランキング|一致率|おすすめ/u);
    expect(document.querySelector("svg[role='img']")).toBeNull();
  });

  it("結果画面から回答を見直すと、回答を残したまま1問目に戻る", () => {
    startDiagnosis();
    ["とても大切", "どちらかといえばB", "わからない", "Aに近い", "大切", "回答しない"].forEach((label) => {
      choose(label);
      fireEvent.click(nextButton());
    });
    fireEvent.click(screen.getByRole("button", { name: /回答を見直す/u }));
    expect(screen.getByText(/6問中/u)).toHaveTextContent("6問中 1問目");
    expect(screen.getByRole("radio", { name: "とても大切" })).toBeChecked();
  });

  it("診断をやめると確認を出し、確認すると回答を消して開始画面に戻る", () => {
    startDiagnosis();
    choose("大切");
    fireEvent.click(screen.getByRole("button", { name: "診断をやめる" }));
    fireEvent.click(screen.getByRole("button", { name: "回答を消してやめる" }));
    expect(heading()).toHaveTextContent("価値観マップ");

    fireEvent.click(screen.getByRole("button", { name: /診断をはじめる/u }));
    expect(screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
  });

  it("回答を localStorage・sessionStorage に書き込まない", () => {
    startDiagnosis();
    ["とても大切", "どちらかといえばB", "わからない", "Aに近い", "大切", "回答しない"].forEach((label) => {
      choose(label);
      fireEvent.click(nextButton());
    });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });
});
