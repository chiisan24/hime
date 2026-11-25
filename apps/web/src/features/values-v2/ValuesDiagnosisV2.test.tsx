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

  it("開始画面に、質問と6つの考え方が暫定で、中立性の点検前であることを出す", () => {
    render(<ValuesDiagnosisV2 />);
    const notice = document.querySelector<HTMLElement>("[data-provisional-axes='true']");
    expect(notice).not.toBeNull();
    expect(notice).toHaveTextContent("中立性の点検前");
    expect(notice).toHaveTextContent(
      "質問の文面、6つの考え方（価値観レーダーの軸）の名前と説明、各質問の考え方A・Bへの割り当ては、暫定です。",
    );
    expect(notice).toHaveTextContent("（中立性の点検）は、まだ終わっていません。");
    // 架空のデモ用の質問であることの表示も残し、常に出す「デモ用の架空データです」の表示は1つのまま
    expect(screen.getByText(/画面を確かめるための架空のデモ用の質問です/u)).toBeInTheDocument();
    expect(screen.getAllByRole("note")).toHaveLength(1);
  });

  it("結果画面にも中立性の点検前であることを出し、分析できた軸がどれも0のときは、0が中立や「同程度」の意味ではないと注記する", () => {
    start();
    answerAll(Array.from({ length: 6 }, () => "Aを強く重視"));
    expect(heading()).toHaveTextContent("あなたの地域課題マップ");
    expect(document.querySelector("[data-provisional-axes='true']")).toHaveTextContent("中立性の点検前");
    expect(screen.getAllByRole("note")).toHaveLength(1);

    const radar = screen.getByRole("region", { name: "価値観レーダー" });
    const allZero = radar.querySelector<HTMLElement>("[data-radar-all-zero='true']");
    const figure = radar.querySelector("figure");
    if (allZero === null || figure === null) {
      throw new Error("the all-zero note or the radar is missing");
    }
    expect(allZero).toHaveTextContent("どの考え方も、傾きが0になりました。");
    expect(allZero).toHaveTextContent(
      "価値観が中立であることや、それぞれの質問で「同程度」を選んだことを意味しません。",
    );
    expect(allZero).toHaveTextContent("打ち消し合って0になります。");
    // 注記は図より前に置き、図は分析結果として描く（6軸とも点を置く）
    expect(allZero.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(figure).toHaveAttribute("data-radar-mode", "analysis");
    expect(figure.querySelectorAll("circle")).toHaveLength(6);
    expect(document.body).not.toHaveTextContent("同じくらい");
  });

  it("一部の軸が分析できず、分析できた軸がどれも0のときは、分析できた考え方について注記する", () => {
    start();
    // 地域交通と医療・福祉をスキップ（公平性は分析できない）し、ほかは「同程度」
    answerAll(["skip", "同程度", "同程度", "skip", "同程度", "同程度"]);
    const allZero = document.querySelector("[data-radar-all-zero='true']");
    expect(allZero).toHaveTextContent("分析できた考え方は、どれも傾きが0になりました。");
    expect(allZero).not.toHaveTextContent("どの考え方も、傾きが0になりました。");
  });

  it("0でない軸があるときと、分析できた軸がないときは、傾き0の注記を出さない", () => {
    const { unmount } = render(<ValuesDiagnosisV2 />);
    fireEvent.click(screen.getByRole("button", { name: /診断をはじめる/u }));
    answerAll(["Aを強く重視", "skip", "同程度", "Bをやや重視", "Aをやや重視", "Bを強く重視"]);
    expect(screen.getByRole("region", { name: "価値観レーダー" })).toBeInTheDocument();
    expect(document.querySelector("[data-radar-all-zero]")).toBeNull();
    unmount();

    // すべてスキップしたときは、0ではなく「分析できません」になる
    start();
    answerAll(Array.from({ length: 6 }, () => "skip"));
    expect(screen.getByRole("region", { name: "価値観レーダー" })).toBeInTheDocument();
    expect(document.querySelector("[data-radar-all-zero]")).toBeNull();
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
    // レーダーは、以前は計算方法が未確定のためサンプル表示だった。計算の仕様（records/values-v2-axis-analysis.md）を
    // 実装したため、回答から計算した値で描き、サンプル表示や「準備中」を出さないことを確かめる
    //（分析の関数が値を作らないときのサンプル表示は、下の別のテストで確かめる）
    const radar = screen.getByRole("region", { name: "価値観レーダー" });
    expect(radar.querySelector("figure")).toHaveAttribute("data-radar-mode", "analysis");
    expect(radar).not.toHaveTextContent(/準備中|サンプル|見本/u);
    expect(within(radar).getByRole("img")).toHaveAccessibleName(/^価値観レーダー/u);
    // 公平性: 地域交通A「Aを強く重視」(+2) と医療・福祉B「Bをやや重視」(+1) → 得点150 → +2
    // 暮らしの安定: 地域交通B (−2) と、スキップした教育・子育て（計算に入れない）→ 1問から −2
    // 将来への投資: 地域経済・雇用A「同程度」(0) と人口減少B「Bを強く重視」(+2) → 得点100 → +1
    // 個人の可能性: スキップした教育・子育てと、人口減少A (−2) → 1問から −2
    // 地域のつながり: 地域経済・雇用B (0) と防災A「Aをやや重視」(+1) → 得点50 → +1
    // 公共基盤の充実: 医療・福祉A (−1) と防災B (−1) → 得点−100 → −1
    const expected = {
      FAIRNESS: "この考え方の側を選ぶことが多かった",
      STABILITY: "もう一方の考え方を選ぶことが多かった（1問から）",
      FUTURE: "この考え方の側をやや選んだ",
      OPPORTUNITY: "もう一方の考え方を選ぶことが多かった（1問から）",
      COMMUNITY: "この考え方の側をやや選んだ",
      INFRASTRUCTURE: "もう一方の考え方をやや選んだ",
    } as const;
    for (const [axisId, text] of Object.entries(expected)) {
      expect(radar.querySelector(`[data-axis-description='${axisId}']`), axisId).toHaveTextContent(text);
    }
    expect(radar.querySelectorAll("figure circle")).toHaveLength(6);
    expect(radar.querySelector("polygon[data-result='area']")).not.toBeNull();
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

  // 以前は既定の分析が PENDING を返していた。既定は計算するようになったため、PENDING を返す分析を差し替えて確かめる
  it("分析の関数が値を作らない（PENDING）あいだのレーダーは、回答によって変わらないサンプル表示になる", () => {
    const pendingAnalyzer: UiAxisAnalyzer = () => ({ status: "PENDING" });
    const radarShapeAfter = (plan: readonly string[]) => {
      const { unmount } = render(<ValuesDiagnosisV2 analyzeAxes={pendingAnalyzer} />);
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

  /** 結果画面のレーダーの値の多角形・点・説明文 */
  function radarSnapshot() {
    const radar = screen.getByRole("region", { name: "価値観レーダー" });
    return {
      mode: radar.querySelector("figure")?.getAttribute("data-radar-mode"),
      shapes: Array.from(radar.querySelectorAll("polygon[data-result]")).map((polygon) =>
        polygon.getAttribute("points"),
      ),
      dots: Object.fromEntries(
        Array.from(radar.querySelectorAll<SVGCircleElement>("figure circle[data-axis]")).map((circle) => [
          circle.dataset.axis,
          `${circle.getAttribute("cx")},${circle.getAttribute("cy")}`,
        ]),
      ),
      texts: Object.fromEntries(
        Array.from(radar.querySelectorAll<HTMLElement>("[data-axis-description]")).map((item) => [
          item.dataset.axisDescription,
          item.textContent,
        ]),
      ),
    };
  }

  it("既定の分析では、回答に応じて六角形の形が変わり、答え直すと、その質問の2つの軸だけが更新される", () => {
    const shapeAfter = (plan: readonly string[]) => {
      const { unmount } = render(<ValuesDiagnosisV2 />);
      fireEvent.click(screen.getByRole("button", { name: /診断をはじめる/u }));
      answerAll(plan);
      const snapshot = radarSnapshot();
      unmount();
      return snapshot;
    };
    // すべて「Aを強く重視」と、すべて「Bを強く重視」は、どちらも全軸が0になる（各軸がA側とB側に1回ずつ出るため）。
    // A と B を交互に強く選ぶと、形が変わる
    const allA = shapeAfter(Array.from({ length: 6 }, () => "Aを強く重視"));
    const allB = shapeAfter(Array.from({ length: 6 }, () => "Bを強く重視"));
    const alternating = shapeAfter(Array.from({ length: 6 }, (_, index) => (index % 2 === 0 ? "Aを強く重視" : "Bを強く重視")));
    expect(allA.mode).toBe("analysis");
    expect(allB.shapes).toEqual(allA.shapes);
    expect(alternating.shapes).not.toEqual(allA.shapes);
    expect(alternating.texts.FAIRNESS).toContain("この考え方の側を選ぶことが多かった");

    render(<ValuesDiagnosisV2 />);
    fireEvent.click(screen.getByRole("button", { name: /診断をはじめる/u }));
    answerAll(Array.from({ length: 6 }, () => "Aを強く重視"));
    const before = radarSnapshot();
    // すべて「Aを強く重視」なら、どの軸も A側の質問で +2、B側の質問で −2 となり、差し引きで得点0（傾き0）。
    // 以前は「どちらとも同じくらいだった」と表示していた。0 は中立や「同程度」の意味ではないため、
    // 差し引きで0になったことと、中立という意味ではないことを示す文に改めた
    //（records/values-v2-axis-analysis.md の10の方針確認2）
    expect(Object.keys(before.texts)).toHaveLength(6);
    for (const text of Object.values(before.texts)) {
      expect(text).toContain("差し引きで0になった");
      expect(text).toContain("中立という意味ではない");
      expect(text).not.toContain("同じくらい");
    }

    // 地域交通（A: 公平性、B: 暮らしの安定）を「Bを強く重視」に答え直す
    const [transport] = DEMO_DILEMMAS;
    if (transport === undefined) {
      throw new Error("demo data is incomplete");
    }
    fireEvent.click(within(mapItem(transport.questionId)).getByRole("button", { name: /この質問に答え直す/u }));
    choose("Bを強く重視");
    for (let index = 1; index <= 6; index += 1) {
      fireEvent.click(nextButton());
    }
    const after = radarSnapshot();
    expect(after.shapes).not.toEqual(before.shapes);
    // 公平性は −2+(−2) = −4 → −2、暮らしの安定は +2+(+2) = +4 → +2
    expect(after.texts.FAIRNESS).toContain("もう一方の考え方を選ぶことが多かった");
    expect(after.texts.STABILITY).toContain("この考え方の側を選ぶことが多かった");
    for (const axisId of ["FUTURE", "OPPORTUNITY", "COMMUNITY", "INFRASTRUCTURE"]) {
      expect(after.texts[axisId], axisId).toBe(before.texts[axisId]);
      expect(after.dots[axisId], axisId).toBe(before.dots[axisId]);
    }
    expect(after.dots.FAIRNESS).not.toBe(before.dots.FAIRNESS);
    expect(after.dots.STABILITY).not.toBe(before.dots.STABILITY);
  });

  it("すべてスキップすると、6軸とも点を置かずに点線で「スキップしました」と示し、0（同じくらい）に描かない", () => {
    start();
    answerAll(Array.from({ length: 6 }, () => "skip"));
    const radar = screen.getByRole("region", { name: "価値観レーダー" });
    expect(radar.querySelector("figure")).toHaveAttribute("data-radar-mode", "analysis");
    expect(radar.querySelectorAll("figure circle")).toHaveLength(0);
    expect(radar.querySelectorAll("polygon[data-result]")).toHaveLength(0);
    expect(radar.querySelectorAll("line[data-undetermined='true']")).toHaveLength(6);
    for (const axis of UI_VALUE_AXES) {
      const text = radar.querySelector(`[data-axis-description='${axis.axisId}']`);
      expect(text).toHaveTextContent("分析できません（この考え方が出てくる質問をスキップしました）");
      expect(text).not.toHaveTextContent("同じくらい");
    }
  });

  /*
   * 画面の流れでは、どの質問も回答かスキップをしないと次へ進めないため、結果画面に未回答の質問は残らない。
   * 未回答（とスキップとの区別）は、axisAnalysis.test.ts と ValueAxisRadar.test.tsx で確かめる。
   */
  it("2問ともスキップした軸は分析できないと示し、片方だけスキップした軸は、もう1問から計算する", () => {
    start();
    // 地域交通と医療・福祉をスキップし、ほかは「同程度」
    answerAll(["skip", "同程度", "同程度", "skip", "同程度", "同程度"]);
    const radar = screen.getByRole("region", { name: "価値観レーダー" });
    // 公平性は、地域交通と医療・福祉の両方をスキップした
    expect(radar.querySelector("[data-axis-description='FAIRNESS']")).toHaveTextContent(
      "分析できません（この考え方が出てくる質問をスキップしました）",
    );
    expect(radar.querySelector("figure circle[data-axis='FAIRNESS']")).toBeNull();
    // 暮らしの安定は、地域交通をスキップし、教育・子育てで「同程度」→ 1問から0（同程度は回答として数える）。
    // 以前の文「どちらとも同じくらいだった（1問から）」は、傾き0の文と「（1問から。中立という意味ではない）」に改めた
    const stability = radar.querySelector("[data-axis-description='STABILITY']");
    expect(stability).toHaveTextContent("差し引きで0になった（1問から。中立という意味ではない）");
    expect(stability).not.toHaveTextContent("同じくらい");
    expect(radar.querySelector("figure circle[data-axis='STABILITY']")).not.toBeNull();
  });

  it("6つの考え方に、軸ごとの分析と、各質問の回答がその軸にどう反映されたかを出す", () => {
    start();
    answerAll(["Aを強く重視", "skip", "同程度", "Bをやや重視", "Aをやや重視", "Bを強く重視"]);
    const section = screen.getByRole("region", { name: "6つの考え方（価値観の軸）" });
    expect(section.querySelector("[data-axis-result='FAIRNESS']")).toHaveTextContent(
      "分析：比べたときに、この考え方の側を選ぶことが多かった",
    );
    const [transport, education, , healthcare] = DEMO_DILEMMAS;
    if (transport === undefined || education === undefined || healthcare === undefined) {
      throw new Error("demo data is incomplete");
    }
    const fairnessTransport = section.querySelector(
      `[data-axis-trace='FAIRNESS'] [data-trace-question='${transport.questionId}']`,
    );
    expect(fairnessTransport).toHaveTextContent("比べた相手：考え方B（暮らしの安定）");
    expect(fairnessTransport).toHaveTextContent("この軸への反映：この考え方の側へ強く");
    // 医療・福祉では公平性は考え方B。「Bをやや重視」は公平性の側へやや
    const fairnessHealthcare = section.querySelector(
      `[data-axis-trace='FAIRNESS'] [data-trace-question='${healthcare.questionId}']`,
    );
    expect(fairnessHealthcare).toHaveTextContent("比べた相手：考え方A（公共基盤の充実）");
    expect(fairnessHealthcare).toHaveTextContent("この軸への反映：この考え方の側へやや");
    // 地域交通の暮らしの安定（考え方B）は、比べた相手の側へ強く
    expect(
      section.querySelector(`[data-axis-trace='STABILITY'] [data-trace-question='${transport.questionId}']`),
    ).toHaveTextContent("この軸への反映：比べた相手の側へ強く");
    // スキップした質問は計算に入れない（0 や「同程度」と書かない）
    for (const link of Array.from(section.querySelectorAll(`[data-trace-question='${education.questionId}']`))) {
      expect(link).toHaveTextContent("この軸への反映：計算に入れていません（回答なし）");
      expect(link.querySelector("[data-trace-contribution]")).toHaveAttribute("data-trace-contribution", "NONE");
    }
  });

  it("質問のデータに誤りがあると、レーダーを描かず、サンプル表示にも切り替えない", () => {
    const [first, ...rest] = DEMO_DILEMMAS;
    if (first === undefined) {
      throw new Error("demo data is incomplete");
    }
    // 考え方AとBが同じ軸の質問（誤り）
    const broken = [{ ...first, optionB: { ...first.optionB, valueAxisId: first.optionA.valueAxisId } }, ...rest];
    render(<ValuesDiagnosisV2 questions={broken} />);
    fireEvent.click(screen.getByRole("button", { name: /診断をはじめる/u }));
    answerAll(Array.from({ length: 6 }, () => "同程度"));
    const radar = screen.getByRole("region", { name: "価値観レーダー" });
    expect(radar.querySelector("[data-radar-invalid='true']")).toHaveTextContent(
      "価値観レーダーを表示できません",
    );
    expect(radar.querySelector("figure")).toBeNull();
    expect(radar).not.toHaveTextContent(/サンプル|見本/u);
    // 回答の振り返りは残る
    expect(screen.getByRole("region", { name: "地域課題ごとの回答の振り返り" })).toBeInTheDocument();
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
