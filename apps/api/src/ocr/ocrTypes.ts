import type { Result } from "@ehime-vote-navigator/domain";

/** A rectangle in page coordinates, 0 to 1, with the origin at the top-left corner. */
export type NormalizedBox = Readonly<{ x0: number; x1: number; y0: number; y1: number }>;

export const FULL_PAGE: NormalizedBox = Object.freeze({ x0: 0, x1: 1, y0: 0, y1: 1 });

export const DEFAULT_RASTER_DPI = 300;
export const MIN_RASTER_DPI = 72;
export const MAX_RASTER_DPI = 600;
/** Larger renderings are refused so one request cannot exhaust memory. */
export const MAX_RASTER_PIXELS = 40_000_000;

/** One rendered part of one PDF page. The PNG is kept in memory unless a caller saves it. */
export type PageImage = Readonly<{
  dpi: number;
  height: number;
  /** 1-based page number of the PDF page. */
  page: number;
  png: Uint8Array;
  /** The part of the page that was rendered, in normalised page coordinates. */
  region: NormalizedBox;
  width: number;
}>;

export const RASTER_ERROR_CODES = [
  "IMAGE_TOO_LARGE",
  "INVALID_REGION",
  "INVALID_REQUEST",
  "PAGE_OUT_OF_RANGE",
  "PDF_CORRUPT",
  "PDF_ENCRYPTED",
  "RENDER_FAILED",
] as const;
export type RasterError = Readonly<{ code: (typeof RASTER_ERROR_CODES)[number] }>;

export type RasterizeRequest = Readonly<{
  dpi?: number;
  page: number;
  /** Renders only this part of the page. The whole page is rendered when omitted. */
  region?: NormalizedBox;
}>;

/** Turns PDF bytes into page images. It knows nothing about how the PDF was obtained. */
export type PageRasterizer = Readonly<{
  rasterize: (
    bytes: Uint8Array,
    requests: readonly RasterizeRequest[],
  ) => Promise<Result<PageImage[], RasterError>>;
}>;

export type OcrOrientation = "horizontal" | "vertical";

/** One recognised line of text. Its box is relative to the whole page, not to the rendered part. */
export type OcrLine = Readonly<{
  box: NormalizedBox;
  confidence: number;
  orientation: OcrOrientation;
  text: string;
}>;

export const OCR_ERROR_CODES = [
  "OCR_ENGINE_UNAVAILABLE",
  "OCR_FAILED",
  "OCR_MODEL_INVALID",
] as const;
export type OcrError = Readonly<{ code: (typeof OCR_ERROR_CODES)[number] }>;

/** Reads the text in a page image. It knows nothing about PDFs or where they came from. */
export type OcrEngine = Readonly<{
  /** Names the engine, its version and its models; part of every cache key. */
  id: string;
  recognize: (image: PageImage) => Promise<Result<OcrLine[], OcrError>>;
}>;

/** A started engine together with its clean-up and diagnostics. */
export type OcrSession = Readonly<{
  close?: () => Promise<void>;
  engine: OcrEngine;
  /** How many network requests the engine tried to make; it must stay 0. */
  networkAttempts?: () => number;
}>;