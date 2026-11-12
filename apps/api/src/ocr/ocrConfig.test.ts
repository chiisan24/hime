import { describe, expect, it } from "vitest";

import {
  DEFAULT_OCR_SETTINGS,
  isDefaultSettings,
  isRecognitionStrategy,
  ocrConfigKey,
  ocrExtractorId,
  trialDirectoryName,
} from "./ocrConfig.js";

describe("OCR settings", () => {
  it("defaults to per-line at 300 dpi and keeps the original directory name", () => {
    expect(DEFAULT_OCR_SETTINGS).toEqual({ dpi: 300, strategy: "per-line" });
    expect(ocrConfigKey(DEFAULT_OCR_SETTINGS)).toBe("per-line-300dpi");
    expect(isDefaultSettings(DEFAULT_OCR_SETTINGS)).toBe(true);
    expect(trialDirectoryName(DEFAULT_OCR_SETTINGS)).toBe("trial");
  });

  it("gives every other combination its own key and directory", () => {
    const combinations = [
      { dpi: 200, strategy: "per-box" },
      { dpi: 200, strategy: "per-line" },
      { dpi: 300, strategy: "per-box" },
    ] as const;

    const names = combinations.map((settings) => trialDirectoryName(settings));

    expect(names).toEqual(["trial-per-box-200dpi", "trial-per-line-200dpi", "trial-per-box-300dpi"]);
    expect(new Set([...names, "trial"]).size).toBe(4);
    expect(combinations.some((settings) => isDefaultSettings(settings))).toBe(false);
  });

  it("adds the resolution to the extractor name of a cache key", () => {
    expect(ocrExtractorId("engine@1", 200)).not.toBe(ocrExtractorId("engine@1", 300));
    expect(ocrExtractorId("engine@1+per-box", 300)).not.toBe(ocrExtractorId("engine@1+per-line", 300));
  });

  it("recognises only the known strategies", () => {
    expect(isRecognitionStrategy("per-box")).toBe(true);
    expect(isRecognitionStrategy("cross-line")).toBe(false);
  });
});