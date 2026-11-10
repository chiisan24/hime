import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Result } from "@ehime-vote-navigator/domain";
import {
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  type PdfError,
  type PdfErrorCode,
  type PdfTextExtractor,
} from "./pdfTextExtractor.js";

/** The small part of pdfjs-dist that the adapter relies on. */
type PdfjsTextItem = Readonly<{ str?: unknown; hasEOL?: unknown }>;
type PdfjsPage = Readonly<{
  getTextContent: () => Promise<{ items: readonly PdfjsTextItem[] }>;
  cleanup: () => unknown;
}>;
type PdfjsDocument = Readonly<{
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfjsPage>;
  destroy: () => Promise<unknown>;
}>;
export type PdfjsModule = Readonly<{
  getDocument: (parameters: Record<string, unknown>) => {
    promise: Promise<PdfjsDocument>;
  };
}>;
export type PdfjsLoader = () => Promise<PdfjsModule>;

export type PdfjsExtractorOptions = Readonly<{
  /** Test seam; the installed pdfjs-dist is loaded by default. */
  loadPdfjs?: PdfjsLoader;
  maxBytes?: number;
  maxPages?: number;
}>;

/** Names the extraction engine in the EXTRACT idempotency key; keep it equal to the package.json version. */
export const PDFJS_EXTRACTOR_ID = "pdfjs-dist@6.5.438";

const require = createRequire(import.meta.url);

function packageDirectory(): string {
  return dirname(require.resolve("pdfjs-dist/package.json"));
}

/** pdf.js wants a directory path that ends with a forward slash, also on Windows. */
function resourceUrl(directory: string, name: string): string {
  return `${directory.replaceAll("\\", "/")}/${name}/`;
}

let defaultModule: Promise<PdfjsModule> | undefined;

/** Loads the legacy (Node-friendly) build of the installed pdfjs-dist once. */
const loadInstalledPdfjs: PdfjsLoader = () => {
  defaultModule ??= import(
    /* @vite-ignore */ pathToFileURL(join(packageDirectory(), "legacy", "build", "pdf.mjs")).href
  ) as Promise<PdfjsModule>;
  return defaultModule;
};

function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "";
}

function classify(error: unknown): PdfErrorCode {
  return errorName(error) === "PasswordException" ? "PDF_ENCRYPTED" : "PDF_CORRUPT";
}

function failure(code: PdfErrorCode): Result<never, PdfError> {
  return { ok: false, error: Object.freeze({ code }) };
}

function pageText(items: readonly PdfjsTextItem[]): string {
  let text = "";
  for (const item of items) {
    if (typeof item.str !== "string") {
      continue;
    }
    text += item.str;
    if (item.hasEOL === true) {
      text += "\n";
    }
  }
  return text;
}

/**
 * PdfTextExtractor backed by pdfjs-dist. It reads only the text layer
 * (no rendering, no OCR), copies the input bytes so the caller's buffer is not
 * detached, and never logs or returns anything but page text and a reason code.
 * Password-protected, corrupt, empty, oversized and over-long documents are
 * reported as PdfError codes.
 */
export function createPdfjsTextExtractor(
  options: PdfjsExtractorOptions = {},
): PdfTextExtractor {
  const loadPdfjs = options.loadPdfjs ?? loadInstalledPdfjs;
  const maxBytes = options.maxBytes ?? MAX_PDF_BYTES;
  const maxPages = options.maxPages ?? MAX_PDF_PAGES;

  return {
    async extract(bytes) {
      if (bytes.byteLength > maxBytes) {
        return failure("PDF_TOO_LARGE");
      }

      const pdfjs = await loadPdfjs();
      const directory = packageDirectory();
      const task = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        cMapUrl: resourceUrl(directory, "cmaps"),
        cMapPacked: true,
        standardFontDataUrl: resourceUrl(directory, "standard_fonts"),
        iccUrl: resourceUrl(directory, "iccs"),
        wasmUrl: resourceUrl(directory, "wasm"),
        useWorkerFetch: false,
        useSystemFonts: false,
        disableFontFace: true,
        enableXfa: false,
        verbosity: 0,
      });

      let document: PdfjsDocument;
      try {
        document = await task.promise;
      } catch (error) {
        return failure(classify(error));
      }

      try {
        const count = document.numPages;
        if (!Number.isInteger(count) || count < 1) {
          return failure("PDF_NO_PAGES");
        }
        if (count > maxPages) {
          return failure("PDF_TOO_MANY_PAGES");
        }

        const pages: string[] = [];
        for (let number = 1; number <= count; number += 1) {
          const page = await document.getPage(number);
          const content = await page.getTextContent();
          pages.push(pageText(content.items));
          page.cleanup();
        }
        return { ok: true, value: pages };
      } catch (error) {
        return failure(classify(error));
      } finally {
        try {
          await document.destroy();
        } catch {
          // Releasing the document is best effort; nothing is left to report.
        }
      }
    },
  };
}