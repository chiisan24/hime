import {
  ExtractionOutputSchema,
  type ExtractionOutput,
  type NotReadyReason,
} from "@ehime-vote-navigator/contracts";
import {
  DEFAULT_MAX_PASSAGE_CHARS,
  attributePassage,
  sha256Hex,
  splitIntoPassages,
  type RegisteredCandidate,
} from "@ehime-vote-navigator/domain";

import {
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  type PdfTextExtractor,
} from "./pdfTextExtractor.js";

export type ExtractStageInput = Readonly<{
  bytes: Uint8Array;
  /** The election's registered candidates; only their registered names are matched. */
  candidates: readonly RegisteredCandidate[];
  extractor: PdfTextExtractor;
  maxPassageChars?: number;
  revision: string;
  sourceId: string;
}>;

function notReady(
  reason: NotReadyReason,
  pageCount = 0,
  imagePages: readonly number[] = [],
): ExtractionOutput {
  return ExtractionOutputSchema.parse({
    pageCount,
    imagePages,
    pages: [],
    passages: [],
    notReady: reason,
  });
}

function hasNoTextLayer(pageText: string): boolean {
  return pageText.replace(/\s+/gu, "").length === 0;
}

/**
 * EXTRACT stage: page texts with 1-based page numbers, image-page detection,
 * passage splitting and candidate attribution. It never calls OCR or Bedrock,
 * never guesses a candidate, and keeps only characters found in the text layer.
 * Any document problem becomes a NOT_READY reason with no pages or passages.
 */
export async function runExtractStage(
  input: ExtractStageInput,
): Promise<ExtractionOutput> {
  if (input.bytes.byteLength > MAX_PDF_BYTES) {
    return notReady("PDF_TOO_LARGE");
  }

  let extracted;
  try {
    extracted = await input.extractor.extract(input.bytes);
  } catch {
    return notReady("PDF_CORRUPT");
  }
  if (!extracted.ok) {
    return notReady(extracted.error.code);
  }

  const pages = extracted.value;
  if (pages.length === 0) {
    return notReady("PDF_NO_PAGES");
  }
  if (pages.length > MAX_PDF_PAGES) {
    return notReady("PDF_TOO_MANY_PAGES", pages.length);
  }

  const imagePages = pages.flatMap((text, index) =>
    hasNoTextLayer(text) ? [index + 1] : [],
  );
  if (imagePages.length === pages.length) {
    return notReady("ALL_PAGES_IMAGE", pages.length, imagePages);
  }

  const passages = splitIntoPassages(
    pages,
    input.maxPassageChars ?? DEFAULT_MAX_PASSAGE_CHARS,
  ).map((passage) => {
    const attribution = attributePassage(passage.text, passage.page, input.candidates);
    return {
      passageId: `${input.sourceId}:${input.revision}:p${passage.page}:${passage.index}`,
      page: passage.page,
      index: passage.index,
      charStart: passage.charStart,
      charEnd: passage.charEnd,
      text: passage.text,
      textSha256: sha256Hex(passage.text),
      assignment: attribution.assignment,
      evidence: attribution.evidence,
    };
  });

  return ExtractionOutputSchema.parse({
    pageCount: pages.length,
    imagePages,
    pages: pages.map((text, index) => ({
      page: index + 1,
      text: hasNoTextLayer(text) ? "" : text,
    })),
    passages,
    notReady: null,
  });
}