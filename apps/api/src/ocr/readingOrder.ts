import type { OcrLine } from "./ocrTypes.js";

/**
 * Puts recognised lines in an approximate reading order: horizontal lines
 * from top to bottom (left to right on the same row), then vertical lines
 * from right to left (top to bottom within a column). It does not detect
 * multi-column layouts, so it is a convenience for joining text only. Every
 * line keeps its box, which lets a reviewer re-order it. The input is not changed.
 */
export function orderLines(lines: readonly OcrLine[]): OcrLine[] {
  const centerY = (line: OcrLine): number => (line.box.y0 + line.box.y1) / 2;
  const centerX = (line: OcrLine): number => (line.box.x0 + line.box.x1) / 2;
  const height = (line: OcrLine): number => line.box.y1 - line.box.y0;

  const horizontal = lines
    .filter((line) => line.orientation === "horizontal")
    .sort((left, right) => {
      const sameRow = Math.abs(centerY(left) - centerY(right)) < Math.min(height(left), height(right)) / 2;
      return sameRow ? left.box.x0 - right.box.x0 : centerY(left) - centerY(right);
    });
  const vertical = lines
    .filter((line) => line.orientation === "vertical")
    .sort((left, right) => centerX(right) - centerX(left) || left.box.y0 - right.box.y0);

  return [...horizontal, ...vertical];
}

/** Joins ordered lines with newlines. */
export function assembleText(lines: readonly OcrLine[]): string {
  return orderLines(lines)
    .map((line) => line.text)
    .join("\n");
}