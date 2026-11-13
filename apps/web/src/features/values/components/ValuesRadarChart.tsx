import { useId } from "react";

import type { LegacyTheme as ValuesTheme, LegacyThemeScore as ThemeScore } from "./legacyTypes.js";
import { describeMissingScore } from "./ThemeBarList.js";

type ValuesRadarChartProps = Readonly<{
  /** 軸の順番（固定。値の大きい順に並べ替えない） */
  themes: readonly ValuesTheme[];
  scores: readonly ThemeScore[];
}>;

const VIEW_WIDTH = 370;
const VIEW_HEIGHT = 264;
const CENTER_X = VIEW_WIDTH / 2;
const CENTER_Y = 132;
// 狭い画面でも軸の名前が読める大きさになるよう、図を小さめにして文字に幅を回す
const RADIUS = 80;
const LEVELS = [1, 2, 3, 4, 5] as const;

type Point = Readonly<{ x: number; y: number }>;

function pointAt(index: number, count: number, distance: number): Point {
  // 1本目の軸を真上にし、時計回りに並べる
  const angle = (-90 + (360 / count) * index) * (Math.PI / 180);
  return {
    x: CENTER_X + distance * Math.cos(angle),
    y: CENTER_Y + distance * Math.sin(angle),
  };
}

function toPath(points: readonly Point[]): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

type LabelLayout = Readonly<{
  x: number;
  nameY: number;
  valueY: number;
  anchor: "start" | "middle" | "end";
}>;

/** 軸の名前と値の置き場所。上下の軸は中央ぞろえ、左右の軸は外側にそろえる */
function labelLayout(index: number, count: number): LabelLayout {
  const point = pointAt(index, count, RADIUS + 14);
  const dx = point.x - CENTER_X;
  const dy = point.y - CENTER_Y;

  if (Math.abs(dx) < 1) {
    return dy < 0
      ? { x: point.x, nameY: point.y - 22, valueY: point.y - 4, anchor: "middle" }
      : { x: point.x, nameY: point.y + 14, valueY: point.y + 32, anchor: "middle" };
  }
  return {
    x: point.x,
    nameY: point.y - 4,
    valueY: point.y + 14,
    anchor: dx > 0 ? "start" : "end",
  };
}

function scoreRatio(score: ThemeScore | undefined): number | null {
  if (score?.status !== "scored" || score.maxScore <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, score.score / score.maxScore));
}

function scoreText(score: ThemeScore | undefined): string {
  if (score?.status === "scored") {
    return `${score.score}/${score.maxScore}`;
  }
  return describeMissingScore(score) ?? "";
}

/**
 * 【非表示】正式な設計（design.md「図の形式の決定」）でレーダーチャートは採用されなかった
 * （軸の長さと面積がスコアの大きさと順位を連想させるため）。結果画面では使っていない。削除せず残している。
 *
 * テーマ別の重要度のレーダーチャート（C-08）。SVGで描く（ライブラリは追加しない）。
 * - 回答なし・判断に迷ったテーマは、その軸を点線にして文字で書く。0として描かない。
 * - 点を結ぶ線は、隣り合う軸がどちらも値を持つときだけ引く。全軸に値があるときだけ塗る。
 * - 図の内容は aria-label の文でも伝える（横棒の一覧と同じ内容）。
 */
export function ValuesRadarChart({ themes, scores }: ValuesRadarChartProps) {
  const captionId = useId();
  const count = themes.length;

  if (count < 3) {
    // 3軸未満では図にならないため、横棒の一覧だけで伝える
    return null;
  }

  const entries = themes.map((theme, index) => {
    const score = scores.find((item) => item.themeId === theme.themeId);
    const ratio = scoreRatio(score);
    return {
      theme,
      index,
      score,
      ratio,
      point: ratio === null ? null : pointAt(index, count, RADIUS * ratio),
    };
  });

  const allScored = entries.every((entry) => entry.point !== null);
  const segments = entries.flatMap((entry) => {
    const next = entries[(entry.index + 1) % count];
    if (entry.point === null || next === undefined || next.point === null) {
      return [];
    }
    return [{ key: entry.theme.themeId, from: entry.point, to: next.point }];
  });

  const description = entries
    .map((entry) => `${entry.theme.name} ${scoreText(entry.score)}`)
    .join("、");

  return (
    <figure className="m-0">
      <svg
        aria-describedby={captionId}
        aria-label={`テーマ別の重要度のレーダーチャート（各テーマ5段階）：${description}`}
        className="mx-auto block h-auto w-full max-w-[28rem]"
        role="img"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      >
        {/* 目盛り（5段階の薄い線） */}
        {LEVELS.map((level) => (
          <polygon
            className="fill-none stroke-line"
            key={level}
            points={toPath(
              themes.map((_, index) => pointAt(index, count, (RADIUS * level) / LEVELS.length)),
            )}
            strokeWidth={1}
          />
        ))}

        {/* 軸。回答なしなどの軸は点線 */}
        {entries.map((entry) => {
          const end = pointAt(entry.index, count, RADIUS);
          return (
            <line
              className={entry.point === null ? "stroke-ink-soft" : "stroke-line"}
              key={entry.theme.themeId}
              strokeDasharray={entry.point === null ? "4 4" : undefined}
              strokeWidth={entry.point === null ? 1.5 : 1}
              x1={CENTER_X}
              x2={end.x}
              y1={CENTER_Y}
              y2={end.y}
            />
          );
        })}

        {allScored ? (
          <polygon
            className="fill-primary/15 stroke-primary"
            points={toPath(entries.flatMap((entry) => (entry.point === null ? [] : [entry.point])))}
            strokeLinejoin="round"
            strokeWidth={2.5}
          />
        ) : (
          segments.map((segment) => (
            <line
              className="stroke-primary"
              key={segment.key}
              strokeLinecap="round"
              strokeWidth={2.5}
              x1={segment.from.x}
              x2={segment.to.x}
              y1={segment.from.y}
              y2={segment.to.y}
            />
          ))
        )}

        {entries.map((entry) =>
          entry.point === null ? null : (
            <circle
              className="fill-white stroke-primary"
              cx={entry.point.x}
              cy={entry.point.y}
              key={entry.theme.themeId}
              r={4.5}
              strokeWidth={2.5}
            />
          ),
        )}

        {/* 軸の名前と値 */}
        {entries.map((entry) => {
          const layout = labelLayout(entry.index, count);
          return (
            <text
              aria-hidden="true"
              key={entry.theme.themeId}
              textAnchor={layout.anchor}
            >
              <tspan className="fill-ink text-[16px] font-bold" x={layout.x} y={layout.nameY}>
                {entry.theme.shortName}
              </tspan>
              <tspan
                className={
                  entry.point === null
                    ? "fill-ink-soft text-[14px] font-bold"
                    : "fill-primary-dark text-[14px] font-bold"
                }
                x={layout.x}
                y={layout.valueY}
              >
                {scoreText(entry.score)}
              </tspan>
            </text>
          );
        })}
      </svg>
      <figcaption className="mt-2 text-xs leading-5 text-ink-soft" id={captionId}>
        図の内容は「テーマ別の重要度」の一覧と同じです。軸の順番は固定で、面積で比べるものではありません。回答なしなどのテーマは点線の軸で示し、0としては描いていません。
      </figcaption>
    </figure>
  );
}
