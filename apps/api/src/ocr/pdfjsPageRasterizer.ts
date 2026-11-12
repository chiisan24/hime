import type { Result } from "@ehime-vote-navigator/domain";

import { loadInstalledPdfjs, pdfjsDocumentParameters } from "../extract/pdfjsTextExtractor.js";
import {
  DEFAULT_RASTER_DPI,
  FULL_PAGE,
  MAX_RASTER_DPI,
  MAX_RASTER_PIXELS,
  MIN_RASTER_DPI,
  type NormalizedBox,
  type PageImage,
  type PageRasterizer,
  type RasterError,
  type RasterizeRequest,
} from "./ocrTypes.js";

type Viewport = Readonly<{ height: number; width: number }>;
type RenderablePage = Readonly<{
  cleanup: () => unknown;
  getViewport: (parameters: { offsetX?: number; offsetY?: number; scale: number }) => Viewport;
  render: (parameters: {
    background: string;
    canvas: unknown;
    canvasContext: unknown;
    viewport: Viewport;
  }) => { promise: Promise<unknown> };
}>;
type RenderableDocument = Readonly<{
  canvasFactory: {
    create: (
      width: number,
      height: number,
    ) => { canvas: { toBuffer: (mimeType: "image/png") => Uint8Array }; context: unknown };
  };
  getPage: (pageNumber: number) => Promise<RenderablePage>;
  numPages: number;
}>;
type RenderingPdfjs = Readonly<{
  getDocument: (parameters: Record<string, unknown>) => {
    destroy?: () => Promise<unknown>;
    promise: Promise<RenderableDocument>;
  };
}>;

export type PdfjsRasterizerOptions = Readonly<{
  /** Test seam; the installed pdfjs-dist is loaded by default. */
  loadPdfjs?: () => Promise<RenderingPdfjs>;
}>;

function failure(code: RasterError["code"]): Result<never, RasterError> {
  return { ok: false, error: Object.freeze({ code }) };
}

function isValidRegion(region: NormalizedBox): boolean {
  const values = [region.x0, region.x1, region.y0, region.y1];
  return (
    values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) &&
    region.x0 < region.x1 &&
    region.y0 < region.y1
  );
}

function validate(request: RasterizeRequest): Result<never, RasterError> | undefined {
  if (!Number.isInteger(request.page) || request.page < 1) {
    return failure("INVALID_REQUEST");
  }
  const dpi = request.dpi ?? DEFAULT_RASTER_DPI;
  if (!Number.isFinite(dpi) || dpi < MIN_RASTER_DPI || dpi > MAX_RASTER_DPI) {
    return failure("INVALID_REQUEST");
  }
  if (request.region !== undefined && !isValidRegion(request.region)) {
    return failure("INVALID_REGION");
  }
  return undefined;
}

async function renderRegion(
  document: RenderableDocument,
  page: RenderablePage,
  request: RasterizeRequest,
): Promise<Result<PageImage, RasterError>> {
  const dpi = request.dpi ?? DEFAULT_RASTER_DPI;
  const scale = dpi / 72;
  const full = page.getViewport({ scale });
  const region = request.region ?? FULL_PAGE;

  const left = Math.floor(region.x0 * full.width);
  const top = Math.floor(region.y0 * full.height);
  const right = Math.ceil(region.x1 * full.width);
  const bottom = Math.ceil(region.y1 * full.height);
  const width = right - left;
  const height = bottom - top;
  if (width < 1 || height < 1) {
    return failure("INVALID_REGION");
  }
  if (width * height > MAX_RASTER_PIXELS) {
    return failure("IMAGE_TOO_LARGE");
  }

  // Only the requested part is drawn: the page is shifted so the part starts at the canvas origin.
  const viewport = page.getViewport({ scale, offsetX: -left, offsetY: -top });
  const { canvas, context } = document.canvasFactory.create(width, height);
  await page.render({
    background: "rgb(255,255,255)",
    canvas,
    canvasContext: context,
    viewport,
  }).promise;

  return {
    ok: true,
    value: {
      dpi,
      height,
      page: request.page,
      png: new Uint8Array(canvas.toBuffer("image/png")),
      region: {
        x0: left / full.width,
        x1: right / full.width,
        y0: top / full.height,
        y1: bottom / full.height,
      },
      width,
    },
  };
}

/**
 * PageRasterizer backed by pdfjs-dist and @napi-rs/canvas. It draws the whole
 * page, so embedded images, vector outlines and the text layer all appear as
 * pixels, and a part of a page can be drawn without drawing the rest. The
 * result has a white opaque background. It never logs, and it copies the input
 * bytes so the caller's buffer is not detached.
 */
export function createPdfjsPageRasterizer(options: PdfjsRasterizerOptions = {}): PageRasterizer {
  const loadPdfjs =
    options.loadPdfjs ?? (loadInstalledPdfjs as unknown as () => Promise<RenderingPdfjs>);

  return {
    async rasterize(bytes, requests) {
      for (const request of requests) {
        const invalid = validate(request);
        if (invalid !== undefined) {
          return invalid;
        }
      }

      const pdfjs = await loadPdfjs();
      const task = pdfjs.getDocument(pdfjsDocumentParameters(bytes));
      let document: RenderableDocument;
      try {
        document = await task.promise;
      } catch (error) {
        const name =
          typeof error === "object" && error !== null && "name" in error
            ? String((error as { name: unknown }).name)
            : "";
        return failure(name === "PasswordException" ? "PDF_ENCRYPTED" : "PDF_CORRUPT");
      }

      try {
        const images: PageImage[] = [];
        for (const request of requests) {
          if (request.page > document.numPages) {
            return failure("PAGE_OUT_OF_RANGE");
          }
          const page = await document.getPage(request.page);
          try {
            const image = await renderRegion(document, page, request);
            if (!image.ok) {
              return image;
            }
            images.push(image.value);
          } finally {
            page.cleanup();
          }
        }
        return { ok: true, value: images };
      } catch {
        return failure("RENDER_FAILED");
      } finally {
        try {
          await task.destroy?.();
        } catch {
          // Releasing the document is best effort; nothing is left to report.
        }
      }
    },
  };
}