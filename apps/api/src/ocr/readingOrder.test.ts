import { describe, expect, it } from "vitest";

import type { OcrLine } from "./ocrTypes.js";
import { assembleText, orderLines } from "./readingOrder.js";

function line(text: string, x0: number, y0: number, x1: number, y1: number, vertical = false): OcrLine {
  return { box: { x0, x1, y0, y1 }, confidence: 0.9, orientation: vertical ? "vertical" : "horizontal", text };
}

describe("orderLines", () => {
  it("orders horizontal lines top to bottom and left to right on the same row", () => {
    const ordered = orderLines([
      line("下", 0.1, 0.5, 0.4, 0.55),
      line("右", 0.5, 0.1, 0.9, 0.15),
      line("左", 0.1, 0.101, 0.4, 0.151),
    ]);

    expect(ordered.map((entry) => entry.text)).toEqual(["左", "右", "下"]);
  });

  it("puts vertical lines after horizontal ones, right to left", () => {
    const ordered = orderLines([
      line("縦左", 0.2, 0.1, 0.25, 0.4, true),
      line("横", 0.1, 0.9, 0.5, 0.95),
      line("縦右", 0.7, 0.1, 0.75, 0.4, true),
    ]);

    expect(ordered.map((entry) => entry.text)).toEqual(["横", "縦右", "縦左"]);
  });

  it("does not change its input and joins text with newlines", () => {
    const input = [line("b", 0.1, 0.5, 0.2, 0.55), line("a", 0.1, 0.1, 0.2, 0.15)];

    expect(assembleText(input)).toBe("a\nb");
    expect(input.map((entry) => entry.text)).toEqual(["b", "a"]);
  });
});