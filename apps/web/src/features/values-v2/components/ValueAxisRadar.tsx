import { useId } from "react";

import type { Level } from "../../values/contractTypes.js";
import type { UiAxisDisplayValue, UiValueAxis } from "../uiTypes.js";

type ValueAxisRadarProps = Readonly<{
  /** 軸の順番（固定。値の大きい順に並べ替えない） */
  axes: readonly UiValueAxis[];
  values: readonly UiAxisDisplayValue[];
}>;

/*
 * 価値観レーダーの表示部品（v2）。【計算処理とは未接続】
 * 6軸の定義と計算方法が確定するまで、診断の結果画面では使わない。
 *
 * 既存の ValuesRadarChart（v1・非表示）を流用しなかった理由:
 * - v1 は「0〜満点」の量を中心から外へ描く。v2 の軸は −2〜+2 の「比べたときの傾き」で、0 を中間の円に置く必要がある。
 * - v1 は全軸がそろうと面を塗る。v2 は面積で比べさせないため、面を塗らない。
 * 角度の計算と、回答のない軸を点線で描く考え方は v1 と同じ。
 */

// 左右の軸名（最長7文字×14）が枠からはみ出さない幅にする
const VIEW_WIDTH = 400;
const VIEW_HEIGHT = 300;
const CENTER_X = VIEW_WIDTH / 2;
const CENTER_Y = 150;
const RADIUS = 88;
const LEVELS: readonly Level[] = [-2, -1, 0, 1, 2];

/** 水準を半径にする。−2 が内側、0 が真ん中の円、+2 が外側 */
function radiusOf(level: Level): number {
  return (RADIUS * (level + 3)) / 5;
}

type Point = Readonly<{ x: number; y: number }>;

function pointAt(index: number, count: number, distance: number): Point {
  const angle = (-90 + (360 / count) * index) * (Math.PI / 180);
  return { x: CENTER_X + distance * Math.cos(angle), y: CENTER_Y + distance * Math.sin(angle) };
}

function toPoints(points: readonly Point[]): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

const LEVEL_TEXT: Readonly<Record<Level, string>> = {
  2: "比べたときに、この考え方の側を選ぶことが多かった",
  1: "比べたときに、この考え方の側をやや選んだ",
  0: "比べたときに、どちらとも同じくらいだった",
  [-1]: "比べたときに、もう一方の考え方をやや選んだ",
  [-2]: "比べたときに、もう一方の考え方を選ぶことが多かった",
};

const UNDETERMINED_TEXT = "分析できません（根拠になる回答がありません）";

function levelSign(level: Level): string {
  return level > 0 ? `+${level}` : String(level);
}

export function describeAxisValue(value: UiAxisDisplayValue | undefined): string {
  if (value === undefined || value.state === "UNDETERMINED") {
    return UNDETERMINED_TEXT;
  }
  const basis = value.usableQuestions === 1 ? "（1問から）" : "";
  return `${LEVEL_TEXT[value.level]}${basis}`;
}

export function ValueAxisRadar({ axes, values }: ValueAxisRadarProps) {
  const captionId = useId();
  const count = axes.length;
  if (count < 3) {
    return null;
  }

  const entries = axes.map((axis, index) => {
    const value = values.find((candidate) => candidate.axisId === axis.axisId);
    const point =
      value !== undefined && value.state === "DETERMINED"
        ? pointAt(index, count, radiusOf(value.level))
        : null;
    return { axis, index, value, point };
  });

  const segments = entries.flatMap((entry) => {
    const next = entries[(entry.index + 1) % count];
    if (entry.point === null || next === undefined || next.point === null) {
      return [];
    }
    return [{ key: entry.axis.axisId, from: entry.point, to: next.point }];
  });

  const description = entries
    .map((entry) => `${entry.axis.label}：${describeAxisValue(entry.value)}`)
    .join("。");

  return (
    <figure className="m-0">
      {/* styles.css の svg { max-width: 100% } が max-w-* より強いため、上限は外側の div で決める */}
      <div className="mx-auto w-full max-w-[28rem]">
        <svg
          aria-describedby={captionId}
          aria-label={`価値観レーダー（6つの考え方を比べたときの傾き）。${description}`}
          className="block h-auto w-full"
          role="img"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        >
          {/* 目盛りの円（−2〜+2）。0 の円だけ太く描く。面は塗らない */}
          {LEVELS.map((level) => (
            <polygon
              className={level === 0 ? "fill-none stroke-ink-soft" : "fill-none stroke-line"}
              data-level={level}
              key={level}
              points={toPoints(axes.map((_, index) => pointAt(index, count, radiusOf(level))))}
              strokeDasharray={level === 0 ? undefined : "2 3"}
              strokeWidth={level === 0 ? 1.5 : 1}
            />
          ))}

          {/* 軸。分析できない軸は点線 */}
          {entries.map((entry) => {
            const end = pointAt(entry.index, count, RADIUS);
            return (
              <line
                className={entry.point === null ? "stroke-ink-soft" : "stroke-line"}
                data-undetermined={entry.point === null ? "true" : undefined}
                key={entry.axis.axisId}
                strokeDasharray={entry.point === null ? "4 4" : undefined}
                strokeWidth={entry.point === null ? 1.5 : 1}
                x1={CENTER_X}
                x2={end.x}
                y1={CENTER_Y}
                y2={end.y}
              />
            );
          })}

          {/* 隣り合う2軸がどちらも分析できたときだけ、細い線で結ぶ */}
          {segments.map((segment) => (
            <line
              className="stroke-primary"
              key={segment.key}
              strokeLinecap="round"
              strokeWidth={2}
              x1={segment.from.x}
              x2={segment.to.x}
              y1={segment.from.y}
              y2={segment.to.y}
            />
          ))}

          {entries.map((entry) =>
            entry.point === null ? null : (
              <circle
                className="fill-white stroke-primary"
                cx={entry.point.x}
                cy={entry.point.y}
                data-axis={entry.axis.axisId}
                key={entry.axis.axisId}
                r={5}
                strokeWidth={2.5}
              />
            ),
          )}

          {/* 軸の名前と値 */}
          {entries.map((entry) => {
            const point = pointAt(entry.index, count, RADIUS + 16);
            const dx = point.x - CENTER_X;
            const anchor = Math.abs(dx) < 1 ? "middle" : dx > 0 ? "start" : "end";
            const above = point.y < CENTER_Y - 1;
            const nameY = Math.abs(dx) < 1 ? (above ? point.y - 16 : point.y + 10) : point.y - 2;
            const valueText =
              entry.value !== undefined && entry.value.state === "DETERMINED"
                ? levelSign(entry.value.level)
                : "分析できません";
            return (
              <text aria-hidden="true" key={entry.axis.axisId} textAnchor={anchor}>
                <tspan className="fill-ink text-[14px] font-bold" x={point.x} y={nameY}>
                  {entry.axis.label}
                </tspan>
                <tspan
                  className={
                    entry.point === null
                      ? "fill-ink-soft text-[12px] font-bold"
                      : "fill-primary-dark text-[12px] font-bold"
                  }
                  x={point.x}
                  y={nameY + 15}
                >
                  {valueText}
                </tspan>
              </text>
            );
          })}
        </svg>
      </div>
      <figcaption className="mt-2 grid gap-2 text-xs leading-5 text-ink-soft" id={captionId}>
        <span>
          6つの考え方を比べたときの傾きです。内側ほど「もう一方の考え方を選んだ」、外側ほど「この考え方を選んだ」を表し、真ん中の線は「同じくらい」です。全部の軸を外側にすることはできず、内側にあっても大切にしていないという意味ではありません。順位でもありません。
        </span>
      </figcaption>
      <ul className="mt-3 grid gap-1.5 text-sm leading-6 text-ink" role="list">
        {entries.map((entry) => (
          <li key={entry.axis.axisId}>
            <span className="font-bold text-primary-dark">{entry.axis.label}</span>：
            {describeAxisValue(entry.value)}
          </li>
        ))}
      </ul>
    </figure>
  );
}
