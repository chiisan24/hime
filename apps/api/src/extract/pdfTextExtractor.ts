import type { NotReadyReason } from "@ehime-vote-navigator/contracts";
import type { Result } from "@ehime-vote-navigator/domain";

/** A document larger than this is not processed (it becomes NOT_READY). */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
/** A document with more pages than this is not processed. */
export const MAX_PDF_PAGES = 200;

export type PdfErrorCode = Extract<
  NotReadyReason,
  "PDF_CORRUPT" | "PDF_ENCRYPTED" | "PDF_NO_PAGES" | "PDF_TOO_LARGE" | "PDF_TOO_MANY_PAGES"
>;

/** A reason the document cannot be read; it never carries document content. */
export type PdfError = Readonly<{ code: PdfErrorCode }>;

/**
 * Reads the text layer of a PDF. The result lists one string per page in
 * document order (index 0 is page 1); a page without a text layer is an empty
 * or blank string. No OCR is ever run behind this port.
 */
export interface PdfTextExtractor {
  extract(bytes: Uint8Array): Promise<Result<readonly string[], PdfError>>;
}