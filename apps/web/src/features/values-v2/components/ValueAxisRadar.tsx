import { useId } from "react";

import type { Level } from "../../values/contractTypes.js";
import type { UiAxisDisplayValue, UiValueAxis } from "../uiTypes.js";

type ValueAxisRadarProps = Readonly<{
  /** 軸の順番（固定。値の大きい順に並べ替えない） */
  axes: readonly UiValueAxis[];
  values: readonly UiAxisDisplayValue[];
  /**
   * サンプル表示（回答から計算していない見本の値）なら true。
   * 図と文に「サンプル表示」と出し、あなたの回答の分析結果ではないことを示す。
   */
  sample?: boolean;
}>;

/*
 * 価値観レーダーの表示部品（v2）。軸ごとの値（UiAxisDisplayValue）を受け取って描くだけで、計算はしない。
 * 回答から値を作るのは UiAxisAnalyzer（axisAnalysis.ts。計算方法が未確定のため、今は値を作らない）。
 *
 * 形: 正六角形の外枠、内側の六角形の目盛り（−2〜+2 の5段）、中心から各頂点への軸、頂点の外側の軸名。
 * 値は −2〜+2 の「比べたときの傾き」で、0 を真ん中の六角形に置く（v1 の ValuesRadarChart の「0〜満点」とは違う）。
 * 値の多角形は半透明の青で塗る（利用者の指示）。面積の大きさに意味がないことは、図の下の説明で伝える。
 * 分析できない軸（値がない軸を含む）は、軸を点線にして「分析できません」と出し、点を置かず、0 として描かない。
 * その軸に接する部分は塗らない（隣り合う2軸がどちらも分析できたところだけを塗る）。
 */

// スマホ（375px）でも軸名が読めるよう、長い軸名は2行にし、左右の文字が枠からはみ出さない幅にする
const VIEW_WIDTH = 400;
const VIEW_HEIGHT = 350;
const CENTER_X = VIEW_WIDTH / 2;
const CENTER_Y = 176;
const RADIUS = 100;
/** 頂点と軸名のあいだの間隔 */
const LABEL_GAP = 12;
const NAME_FONT_CLASS = "text-[16px]";
const NAME_LINE_HEIGHT = 19;
const VALUE_FONT_CLASS = "text-[14px]";
const VALUE_LINE_HEIGHT = 17;
const LEVELS: readonly Level[] = [-2, -1, 0, 1, 2];
/** 外側から内側へ塗る帯の色（白と薄い青灰色を交互に） */
const BAND_FILL_CLASS: Readonly<Record<Level, string>> = {
  2: "fill-surface",
  1: "fill-white",
  0: "fill-surface",
  [-1]: "fill-white",
  [-2]: "fill-surface",
};

/** 水準を半径にする。−2 が内側、0 が真ん中の六角形、+2 が外枠 */
function radiusOf(level: Level): number {
  return (RADIUS * (level + 3)) / 5;
}

type Point = Readonly<{ x: number; y: number }>;

const CENTER: Point = { x: CENTER_X, y: CENTER_Y };

function pointAt(index: number, count: number, distance: number): Point {
  const angle = (-90 + (360 / count) * index) * (Math.PI / 180);
  return { x: CENTER_X + distance * Math.cos(angle), y: CENTER_Y + distance * Math.sin(angle) };
}

function toPoints(points: readonly Point[]): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

/** 長い軸名を2行に分ける。「の」の後ろで分け、ないときは半分で分ける */
export function axisLabelLines(label: string): readonly string[] {
  const characters = Array.from(label);
  if (characters.length <= 4) {
    return [label];
  }
  const index = characters.indexOf("の");
  const cut = index >= 1 && index < characters.length - 1 ? index + 1 : Math.ceil(characters.length / 2);
  return [characters.slice(0, cut).join(""), characters.slice(cut).join("")];
}

const LEVEL_TEXT: Readonly<Record<Level, string>> = {
  2: "比べたときに、この考え方の側を選ぶことが多かった",
  1: "比べたときに、この考え方の側をやや選んだ",
  0: "比べたときに、どちらとも同じくらいだった",
  [-1]: "比べたときに、もう一方の考え方をやや選んだ",
  [-2]: "比べたときに、もう一方の考え方を選ぶことが多かった",
};

const UNDETERMINED_TEXT = "分析できません（根拠になる回答がありません）";
const SAMPLE_LABEL = "サンプル表示";

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

type LabelLayout = Readonly<{
  x: number;
  anchor: "start" | "middle" | "end";
  /** 軸名の各行と値の行のベースライン */
  nameYs: readonly number[];
  valueY: number;
}>;

/** 軸名と値の置き場所。上の頂点は上に、下の頂点は下に、左右の頂点は横に、行のかたまりを置く */
function labelLayout(index: number, count: number, lineCount: number): LabelLayout {
  const vertex = pointAt(index, count, RADIUS);
  const point = pointAt(index, count, RADIUS + LABEL_GAP);
  const dx = point.x - CENTER_X;
  const dy = point.y - CENTER_Y;
  const anchor = Math.abs(dx) < 1 ? "middle" : dx > 0 ? "start" : "end";
  const blockHeight = NAME_LINE_HEIGHT * lineCount + VALUE_LINE_HEIGHT;
  // ベースラインは文字の下端に近いので、かたまりの上端から 1 行目の高さの 0.8 倍だけ下げる
  const ascent = NAME_LINE_HEIGHT * 0.8;
  let top: number;
  if (anchor === "middle" && dy < 0) {
    top = vertex.y - LABEL_GAP - blockHeight;
  } else if (anchor === "middle") {
    top = vertex.y + LABEL_GAP;
  } else {
    top = point.y - blockHeight / 2;
  }
  const nameYs = Array.from({ length: lineCount }, (_, line) => top + ascent + NAME_LINE_HEIGHT * line);
  const valueY = top + ascent + NAME_LINE_HEIGHT * (lineCount - 1) + VALUE_LINE_HEIGHT;
  return { x: point.x, anchor, nameYs, valueY };
}

export function ValueAxisRadar({ axes, values, sample = false }: ValueAxisRadarProps) {
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
  const allDetermined = entries.every((entry) => entry.point !== null);

  /** 隣り合う2軸がどちらも分析できたところ（線で結び、中心との三角形を塗る） */
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
  const imageLabel = sample
    ? `${SAMPLE_LABEL}の価値観レーダー（見本の値です。あなたの回答の分析結果ではありません）。${description}`
    : `価値観レーダー（6つの考え方を比べたときの傾き）。${description}`;

  return (
    <figure className="m-0" data-radar-mode={sample ? "sample" : "analysis"}>
      {/* styles.css の svg { max-width: 100% } が max-w-* より強いため、上限は外側の div で決める */}
      <div className="mx-auto w-full max-w-[30rem]">
        <svg
          aria-describedby={captionId}
          aria-label={imageLabel}
          className="block h-auto w-full"
          role="img"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        >
          {/* 目盛りの六角形（外枠が +2、真ん中が 0、内側が −2）。外側から順に、白と薄い色の帯で塗る */}
          {[...LEVELS].reverse().map((level) => (
            <polygon
              className={`${BAND_FILL_CLASS[level]} ${
                level === 2 ? "stroke-primary-dark/45" : level === 0 ? "stroke-ink-soft/70" : "stroke-line"
              }`}
              data-level={level}
              key={level}
              points={toPoints(axes.map((_, index) => pointAt(index, count, radiusOf(level))))}
              strokeLinejoin="round"
              strokeWidth={level === 2 ? 1.75 : level === 0 ? 1.25 : 1}
            />
          ))}

          {/* 中心から各頂点への軸。分析できない軸は点線 */}
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

          {/* 値の多角形（半透明の青）。全軸を分析できたときは1つの多角形、そうでないときは分析できたところだけ */}
          {allDetermined ? (
            <polygon
              className="fill-primary/30 stroke-primary"
              data-result="area"
              points={toPoints(entries.flatMap((entry) => (entry.point === null ? [] : [entry.point])))}
              strokeLinejoin="round"
              strokeWidth={2.5}
            />
          ) : (
            <>
              {segments.map((segment) => (
                <polygon
                  className="fill-primary/30"
                  data-result="wedge"
                  key={`wedge-${segment.key}`}
                  points={toPoints([CENTER, segment.from, segment.to])}
                />
              ))}
              {segments.map((segment) => (
                <line
                  className="stroke-primary"
                  key={`edge-${segment.key}`}
                  strokeLinecap="round"
                  strokeWidth={2.5}
                  x1={segment.from.x}
                  x2={segment.to.x}
                  y1={segment.from.y}
                  y2={segment.to.y}
                />
              ))}
            </>
          )}

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

          {/* 頂点の外側の軸名と値 */}
          {entries.map((entry) => {
            const lines = axisLabelLines(entry.axis.label);
            const layout = labelLayout(entry.index, count, lines.length);
            const valueText =
              entry.value !== undefined && entry.value.state === "DETERMINED"
                ? levelSign(entry.value.level)
                : "分析できません";
            return (
              <text aria-hidden="true" key={entry.axis.axisId} textAnchor={layout.anchor}>
                {lines.map((line, lineIndex) => (
                  <tspan
                    className={`fill-primary-dark ${NAME_FONT_CLASS} font-bold`}
                    key={line}
                    x={layout.x}
                    y={layout.nameYs[lineIndex]}
                  >
                    {line}
                  </tspan>
                ))}
                <tspan
                  className={
                    entry.point === null
                      ? `fill-ink-soft ${VALUE_FONT_CLASS} font-bold`
                      : `fill-primary ${VALUE_FONT_CLASS} font-bold`
                  }
                  x={layout.x}
                  y={layout.valueY}
                >
                  {valueText}
                </tspan>
              </text>
            );
          })}

          {/* サンプル表示の印（左上） */}
          {sample ? (
            <g aria-hidden="true" data-sample-mark="true">
              <rect className="fill-primary-dark" height={24} rx={12} width={104} x={6} y={6} />
              <text className="fill-white text-[13px] font-bold" textAnchor="middle" x={58} y={22.5}>
                {SAMPLE_LABEL}
              </text>
            </g>
          ) : null}
        </svg>
      </div>
      <figcaption className="mt-2 grid gap-2 text-xs leading-5 text-ink-soft" id={captionId}>
        {sample ? (
          <span className="font-bold text-primary-dark">
            {SAMPLE_LABEL}：見本の値で図の見方を示しています。あなたの回答の分析結果ではありません。
          </span>
        ) : null}
        <span>
          6つの考え方を比べたときの傾きです。内側ほど「もう一方の考え方を選んだ」、外側ほど「この考え方を選んだ」を表し、真ん中の六角形は「同じくらい」です。全部の軸を外側にすることはできず、内側にあっても大切にしていないという意味ではありません。面積の大きさに意味はなく、順位でもありません。点線の軸は、根拠になる回答がないため分析できない軸です。
        </span>
      </figcaption>
      {sample ? (
        <p className="mt-3 text-sm font-bold leading-6 text-primary-dark">
          見本の値の説明（あなたの回答の分析結果ではありません）
        </p>
      ) : null}
      <ul className={`${sample ? "mt-1" : "mt-3"} grid gap-1.5 text-sm leading-6 text-ink`} role="list">
        {entries.map((entry) => (
          <li data-axis-description={entry.axis.axisId} key={entry.axis.axisId}>
            <span className="font-bold text-primary-dark">{entry.axis.label}</span>：
            {describeAxisValue(entry.value)}
          </li>
        ))}
      </ul>
    </figure>
  );
}
