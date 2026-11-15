// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import "../../../../../tests/harness/react-renderer.js";
import { ValueAxisRadar } from "./components/ValueAxisRadar.js";
import { UI_VALUE_AXES } from "./demoDilemmas.js";

/*
 * 価値観レーダーの表示部品の確認（計算処理とは未接続。ここではテスト用の値だけを渡す）。
 */

describe("ValueAxisRadar（v2・表示部品）", () => {
  it("分析できる軸だけに点を描き、分析できない軸は点線にして文字で示す", () => {
    const { container } = render(
      <ValueAxisRadar
        axes={UI_VALUE_AXES}
        values={[
          { axisId: "FAIRNESS", state: "DETERMINED", level: 2, usableQuestions: 2 },
          { axisId: "STABILITY", state: "DETERMINED", level: -1, usableQuestions: 1 },
          { axisId: "FUTURE", state: "UNDETERMINED" },
        ]}
      />,
    );

    expect(container.querySelectorAll("circle")).toHaveLength(2);
    // 値を渡していない軸も、分析できない軸として扱う（0 として描かない）
    expect(container.querySelectorAll("line[data-undetermined='true']")).toHaveLength(4);
    expect(screen.getByText(/公平性/u, { selector: "li span" }).parentElement).toHaveTextContent(
      "この考え方の側を選ぶことが多かった",
    );
    expect(screen.getByText(/暮らしの安定/u, { selector: "li span" }).parentElement).toHaveTextContent(
      "（1問から）",
    );
    expect(screen.getByText(/将来への投資/u, { selector: "li span" }).parentElement).toHaveTextContent(
      "分析できません",
    );
  });

  it("面を塗らず、0 の目盛りを描き、図と同じ内容を読み上げ用の文でも持つ", () => {
    const { container } = render(
      <ValueAxisRadar
        axes={UI_VALUE_AXES}
        values={UI_VALUE_AXES.map((axis) => ({
          axisId: axis.axisId,
          state: "DETERMINED" as const,
          level: 0 as const,
          usableQuestions: 2,
        }))}
      />,
    );

    for (const polygon of Array.from(container.querySelectorAll("polygon"))) {
      expect(polygon.getAttribute("class")).toContain("fill-none");
    }
    expect(container.querySelector("polygon[data-level='0']")).not.toBeNull();
    const image = screen.getByRole("img");
    for (const axis of UI_VALUE_AXES) {
      expect(image.getAttribute("aria-label")).toContain(axis.label);
    }
    expect(document.body).not.toHaveTextContent(/順位は|位$|ランキング|一致率/u);
  });

  it("軸が3つ未満なら何も描かない", () => {
    const { container } = render(<ValueAxisRadar axes={UI_VALUE_AXES.slice(0, 2)} values={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
