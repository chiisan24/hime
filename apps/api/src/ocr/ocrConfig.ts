import { DEFAULT_RASTER_DPI } from "./ocrTypes.js";

/**
 * How the recognition step treats the text boxes the detector found.
 * `per-line` joins boxes on one row into a single wide crop; `per-box`
 * recognises every box on its own, which suits multi-column layouts.
 */
export const RECOGNITION_STRATEGIES = ["per-line", "per-box"] as const;
export type RecognitionStrategy = (typeof RECOGNITION_STRATEGIES)[number];

export function isRecognitionStrategy(value: string): value is RecognitionStrategy {
  return (RECOGNITION_STRATEGIES as readonly string[]).includes(value);
}

/** The settings that change what the OCR produces. */
export type OcrSettings = Readonly<{ dpi: number; strategy: RecognitionStrategy }>;

export const DEFAULT_OCR_SETTINGS: OcrSettings = Object.freeze({
  dpi: DEFAULT_RASTER_DPI,
  strategy: "per-line",
});

/** A short name for one combination of settings, for example `per-box-200dpi`. */
export function ocrConfigKey(settings: OcrSettings): string {
  return `${settings.strategy}-${settings.dpi}dpi`;
}

export function isDefaultSettings(settings: OcrSettings): boolean {
  return ocrConfigKey(settings) === ocrConfigKey(DEFAULT_OCR_SETTINGS);
}

/**
 * Results of different settings never share a directory, so one run cannot be
 * mistaken for another. The default settings keep the original `trial` name.
 */
export function trialDirectoryName(settings: OcrSettings): string {
  return isDefaultSettings(settings) ? "trial" : `trial-${ocrConfigKey(settings)}`;
}

/**
 * The extractor name for a cache key (see the EXTRACT stage): the engine id
 * already names the models and the strategy; the resolution is added here.
 */
export function ocrExtractorId(engineId: string, dpi: number): string {
  return `${engineId}@${dpi}dpi`;
}