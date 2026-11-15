// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import "../../../../../tests/harness/react-renderer.js";
import { axisLabelLines, ValueAxisRadar } from "./components/ValueAxisRadar.js";
import { UI_VALUE_AXES } from "./demoDilemmas.js";

/*
 * 価値観レーダーの表示部品の確認（計算処理とは未接続。ここではテスト用の値だけを渡す）。
 */

type Point = Readonly<{ x: number; y: number }>;

/** SVG の polygon の points を座標の配列にする */
function pointsOf(polygon: Element | null): Point[] {
  return (polygon?.getAttribute("points") ?? "")
    .trim()
    .split(/\s+/u)
    .filter((pair) => pair !== "")
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x: x ?? Number.NaN, y: y ?? Number.NaN };
    });
}

function centroidOf(points: readonly Point[]): Point {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

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

  /*
   * 以前は「面を塗らない」ことを確かめていた（面積で比べさせないため）。利用者の指示で、値の多角形を
   * 半透明の青で塗る形に変えたため、塗りが半透明であることと、面積に意味がないことを図の説明で
   * 伝えていることを確かめる。0 の目盛りと読み上げ用の文の確認は、そのまま残す。
   */
  it("値の多角形は半透明の青で塗り、面積に意味がないことを示し、0 の目盛りを描き、図と同じ内容を読み上げ用の文でも持つ", () => {
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

    const area = container.querySelector("polygon[data-result='area']");
    expect(area).not.toBeNull();
    const opacity = /\bfill-primary\/(\d+)\b/u.exec(area?.getAttribute("class") ?? "")?.[1];
    expect(Number(opacity)).toBeGreaterThan(0);
    expect(Number(opacity)).toBeLessThan(100);
    // 目盛りの帯は、白か薄い色（値の青とは別の色）
    for (const ring of Array.from(container.querySelectorAll("polygon[data-level]"))) {
      expect(ring.getAttribute("class")).toMatch(/\bfill-(?:white|surface)\b/u);
    }
    expect(screen.getByText(/面積の大きさに意味はなく、順位でもありません/u)).toBeInTheDocument();
    expect(container.querySelector("polygon[data-level='0']")).not.toBeNull();
    const image = screen.getByRole("img");
    for (const axis of UI_VALUE_AXES) {
      expect(image.getAttribute("aria-label")).toContain(axis.label);
    }
    expect(document.body).not.toHaveTextContent(/順位は|位$|ランキング|一致率/u);
  });

  it("正六角形の外枠と、同じ中心の六角形の目盛り（−2〜+2）、中心から6頂点への軸を描く", () => {
    const { container } = render(<ValueAxisRadar axes={UI_VALUE_AXES} values={[]} />);

    const rings = Array.from(container.querySelectorAll("polygon[data-level]"));
    expect(rings.map((ring) => ring.getAttribute("data-level")).sort()).toEqual(["-1", "-2", "0", "1", "2"]);
    const centers = rings.map((ring) => {
      const points = pointsOf(ring);
      expect(points).toHaveLength(6);
      const center = centroidOf(points);
      // 正六角形: 中心から6頂点までの距離と、6辺の長さが、それぞれすべて等しい
      const radii = points.map((point) => distance(point, center));
      const edges = points.map((point, index) => distance(point, points[(index + 1) % points.length] ?? point));
      for (const value of [...radii, ...edges]) {
        expect(value).toBeCloseTo(radii[0] ?? 0, 0);
      }
      // 正六角形の辺の長さは、中心から頂点までの距離と等しい
      expect(edges[0]).toBeCloseTo(radii[0] ?? 0, 0);
      return { center, radius: radii[0] ?? 0, level: Number(ring.getAttribute("data-level")) };
    });
    for (const { center } of centers) {
      expect(center.x).toBeCloseTo(centers[0]?.center.x ?? 0, 0);
      expect(center.y).toBeCloseTo(centers[0]?.center.y ?? 0, 0);
    }
    // 外側ほど大きい（外枠が +2）
    const byLevel = [...centers].sort((left, right) => left.level - right.level);
    for (let index = 1; index < byLevel.length; index += 1) {
      expect(byLevel[index]?.radius ?? 0).toBeGreaterThan(byLevel[index - 1]?.radius ?? 0);
    }

    // 6本の軸は中心から外枠の各頂点へ伸びる
    const outer = pointsOf(container.querySelector("polygon[data-level='2']"));
    const axes = Array.from(container.querySelectorAll("line"));
    expect(axes).toHaveLength(6);
    axes.forEach((line, index) => {
      expect(Number(line.getAttribute("x1"))).toBeCloseTo(centers[0]?.center.x ?? 0, 0);
      expect(Number(line.getAttribute("y1"))).toBeCloseTo(centers[0]?.center.y ?? 0, 0);
      expect(Number(line.getAttribute("x2"))).toBeCloseTo(outer[index]?.x ?? 0, 0);
      expect(Number(line.getAttribute("y2"))).toBeCloseTo(outer[index]?.y ?? 0, 0);
    });

    // 軸名は6つ。長い軸名は2行に分ける
    const labels = Array.from(container.querySelectorAll("svg text[aria-hidden='true']")).filter(
      (text) => text.closest("[data-sample-mark]") === null,
    );
    expect(labels).toHaveLength(6);
    expect(labels.map((text) => text.textContent)).toEqual(
      UI_VALUE_AXES.map((axis) => `${axis.label}分析できません`),
    );
  });

  it("値が変わると多角形が変わり、分析できない軸は0に置かず、その軸に接するところを塗らない", () => {
    const levelOf = (level: -2 | -1 | 0 | 1 | 2) =>
      UI_VALUE_AXES.map((axis) => ({
        axisId: axis.axisId,
        state: "DETERMINED" as const,
        level,
        usableQuestions: 2,
      }));
    const { container, rerender } = render(<ValueAxisRadar axes={UI_VALUE_AXES} values={levelOf(2)} />);
    const outerArea = container.querySelector("polygon[data-result='area']")?.getAttribute("points");
    expect(outerArea).toBe(container.querySelector("polygon[data-level='2']")?.getAttribute("points"));

    rerender(<ValueAxisRadar axes={UI_VALUE_AXES} values={levelOf(-1)} />);
    const innerArea = container.querySelector("polygon[data-result='area']")?.getAttribute("points");
    expect(innerArea).toBe(container.querySelector("polygon[data-level='-1']")?.getAttribute("points"));
    expect(innerArea).not.toBe(outerArea);

    // 1軸だけ分析できない（スキップなどで根拠がない）
    rerender(
      <ValueAxisRadar
        axes={UI_VALUE_AXES}
        values={levelOf(1).map((value) =>
          value.axisId === "OPPORTUNITY" ? { axisId: "OPPORTUNITY" as const, state: "UNDETERMINED" as const } : value,
        )}
      />,
    );
    expect(container.querySelector("polygon[data-result='area']")).toBeNull();
    expect(container.querySelector("circle[data-axis='OPPORTUNITY']")).toBeNull();
    expect(container.querySelectorAll("circle")).toHaveLength(5);
    expect(container.querySelectorAll("line[data-undetermined='true']")).toHaveLength(1);
    // 塗るのは、隣り合う2軸がどちらも分析できたところだけ（6か所のうち、分析できない軸に接する2か所を除く）
    const wedges = Array.from(container.querySelectorAll("polygon[data-result='wedge']"));
    expect(wedges).toHaveLength(4);
    const dots = Array.from(container.querySelectorAll("circle")).map((circle) => ({
      x: Number(circle.getAttribute("cx")),
      y: Number(circle.getAttribute("cy")),
    }));
    const [center] = pointsOf(wedges[0] ?? null);
    for (const wedge of wedges) {
      const [apex, ...others] = pointsOf(wedge);
      expect(apex).toEqual(center);
      // 中心以外の頂点は、分析できた軸の点だけ（分析できない軸の上に、0 などの点を作らない）
      for (const vertex of others) {
        expect(dots.some((dot) => distance(dot, vertex) < 0.2)).toBe(true);
      }
    }
    const opportunity = Array.from(container.querySelectorAll("svg text[aria-hidden='true']")).find((text) =>
      text.textContent?.startsWith("個人の"),
    );
    expect(opportunity).toHaveTextContent("分析できません");
  });

  it("サンプル表示では、図と文に「サンプル表示」と出し、分析結果ではないことを示す", () => {
    const values = UI_VALUE_AXES.map((axis) => ({
      axisId: axis.axisId,
      state: "DETERMINED" as const,
      level: 1 as const,
      usableQuestions: 2,
    }));
    const { container, rerender } = render(<ValueAxisRadar axes={UI_VALUE_AXES} sample values={values} />);

    expect(container.querySelector("figure")).toHaveAttribute("data-radar-mode", "sample");
    expect(screen.getByRole("img")).toHaveAccessibleName(
      /^サンプル表示の価値観レーダー（見本の値です。あなたの回答の分析結果ではありません）/u,
    );
    expect(container.querySelector("[data-sample-mark]")).toHaveTextContent("サンプル表示");
    expect(screen.getByText(/見本の値で図の見方を示しています。あなたの回答の分析結果ではありません/u)).toBeInTheDocument();
    expect(screen.getByText("見本の値の説明（あなたの回答の分析結果ではありません）")).toBeInTheDocument();

    rerender(<ValueAxisRadar axes={UI_VALUE_AXES} values={values} />);
    expect(container.querySelector("figure")).toHaveAttribute("data-radar-mode", "analysis");
    expect(screen.getByRole("img").getAttribute("aria-label")).not.toMatch(/サンプル/u);
    expect(container.querySelector("[data-sample-mark]")).toBeNull();
    expect(document.body).not.toHaveTextContent(/サンプル|見本/u);
  });

  it("長い軸名を「の」の後ろで2行に分け、どの行も5文字以内にする（スマホでも枠に収まる長さ）", () => {
    expect(axisLabelLines("公平性")).toEqual(["公平性"]);
    expect(axisLabelLines("暮らしの安定")).toEqual(["暮らしの", "安定"]);
    expect(axisLabelLines("公共基盤の充実")).toEqual(["公共基盤の", "充実"]);
    expect(axisLabelLines("地域のつながり")).toEqual(["地域の", "つながり"]);
    expect(axisLabelLines("あいうえおかき")).toEqual(["あいうえ", "おかき"]);
    for (const axis of UI_VALUE_AXES) {
      const lines = axisLabelLines(axis.label);
      expect(lines.join("")).toBe(axis.label);
      for (const line of lines) {
        expect(Array.from(line).length, axis.label).toBeLessThanOrEqual(5);
      }
    }
  });

  it("軸が3つ未満なら何も描かない", () => {
    const { container } = render(<ValueAxisRadar axes={UI_VALUE_AXES.slice(0, 2)} values={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
