import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { sha256Hex } from "@ehime-vote-navigator/domain";

import { createStoragePathConfig } from "../config/paths.js";
import { scanPdfStructure } from "../extract/pdfStructure.js";
import type { PdfTextExtractor } from "../extract/pdfTextExtractor.js";
import {
  assessTextQuality,
  type PageAssessment,
  type TextQualityReport,
} from "../extract/textQuality.js";
import type { AtomicFileOperationOverrides } from "../store/atomicFiles.js";
import { atomicReplaceFile } from "../store/atomicReplaceFile.js";

export type InspectArgs = Readonly<{ file: string; writeReview: boolean }>;

export type InspectDependencies = Readonly<{
  extractor: PdfTextExtractor;
  io: Readonly<{ write: (line: string) => void }>;
  /** Test seam for the review file write; the real filesystem is the default. */
  operations?: AtomicFileOperationOverrides;
  workspaceRoot: string;
}>;

/** A PDF placed directly in `data/real/raw`; no path separators, no `..`. */
const RAW_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.pdf$/iu;

/** True for the name of a PDF placed directly in `data/real/raw`: no separators, no `..`. */
export function isRawPdfFileName(name: string): boolean {
  return RAW_FILE_NAME.test(name) && !name.includes("..");
}

export function parseInspectArgs(args: readonly string[]): InspectArgs | undefined {
  let file: string | undefined;
  let writeReview = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--write-review") {
      if (writeReview) {
        return undefined;
      }
      writeReview = true;
      continue;
    }
    if (arg !== "--file") {
      return undefined;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--") || file !== undefined) {
      return undefined;
    }
    file = value;
    index += 1;
  }
  return file === undefined ? undefined : { file, writeReview };
}

function reject(io: InspectDependencies["io"], code: string, message: string): number {
  io.write(`Inspect rejected: ${code}`);
  io.write(message);
  return 1;
}

function pageLine(assessment: PageAssessment): string {
  const { metrics, flags } = assessment;
  return [
    `Page ${metrics.page}: chars=${metrics.chars}`,
    `lines=${metrics.lines}`,
    `kanji=${metrics.kanji}`,
    `hiragana=${metrics.hiragana}`,
    `katakana=${metrics.katakana}`,
    `asciiLetters=${metrics.asciiLetters}`,
    `distinctAsciiLetters=${metrics.distinctAsciiLetters}`,
    `longestAsciiRun=${metrics.longestAsciiLetterRun}`,
    `digits=${metrics.digits}`,
    `punctuation=${metrics.punctuation}`,
    `fullwidth=${metrics.fullwidth}`,
    `replacement=${metrics.replacement}`,
    `privateUse=${metrics.privateUse}`,
    `control=${metrics.control}`,
    `other=${metrics.other}`,
    `fillerLines=${metrics.fillerLines}`,
    `sharedLines=${metrics.sharedLines}`,
    `ownChars=${metrics.ownChars}`,
    `japaneseShare=${metrics.japaneseShare.toFixed(2)}`,
    `flags=${flags.length === 0 ? "none" : flags.join(",")}`,
  ].join(" ");
}

function reviewText(
  file: string,
  sha256: string,
  pages: readonly string[],
  report: TextQualityReport,
): string {
  const lines = [
    "Local review copy of the extracted text. Do not commit, upload or publish it.",
    `file=${file} sha256=${sha256} pages=${pages.length} verdict=${report.verdict}`,
    "",
  ];
  for (const [index, text] of pages.entries()) {
    const assessment = report.pages[index];
    lines.push(
      `===== Page ${index + 1} (${assessment?.metrics.chars ?? 0} characters) =====`,
      text,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Reads the text layer of a PDF in `data/real/raw` and prints per-page counts,
 * suspicion flags and a verdict. Page text is never printed. With
 * `--write-review` the text is also written to `data/real/review/<sha256>/pages.txt`
 * (Git ignored) so a person can compare it with the original. It never runs OCR,
 * calls Bedrock or changes the PDF.
 */
export async function inspectPdf(
  args: InspectArgs,
  dependencies: InspectDependencies,
): Promise<number> {
  const { io } = dependencies;
  if (!isRawPdfFileName(args.file)) {
    return reject(io, "INVALID_FILE_NAME", "Give the name of a PDF placed directly in data/real/raw.");
  }

  const storage = createStoragePathConfig(dependencies.workspaceRoot);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(join(storage.realDataRoot, "raw", args.file)));
  } catch {
    return reject(io, "RAW_FILE_UNREADABLE", "The file could not be read from data/real/raw.");
  }

  let extracted;
  try {
    extracted = await dependencies.extractor.extract(bytes);
  } catch {
    return reject(io, "PDF_CORRUPT", "The text layer could not be read.");
  }
  if (!extracted.ok) {
    return reject(io, extracted.error.code, "The text layer could not be read.");
  }

  const pages = extracted.value;
  const sha256 = sha256Hex(bytes);
  const report = assessTextQuality(pages);
  const structure = scanPdfStructure(bytes);

  io.write(`Inspect: file=${args.file} bytes=${bytes.byteLength} sha256=${sha256} pages=${pages.length}`);
  for (const assessment of report.pages) {
    io.write(pageLine(assessment));
  }
  io.write(
    `Structure (approximate): images=${structure.images} fonts=${structure.fonts} type0Fonts=${structure.type0Fonts} cidFonts=${structure.cidFonts} toUnicodeMaps=${structure.toUnicodeMaps} encrypted=${structure.encrypted}`,
  );
  if (structure.compressedObjectStreams > 0) {
    io.write(
      `Structure note: ${structure.compressedObjectStreams} compressed object streams were not scanned, so the counts can be low.`,
    );
  }
  io.write(
    `Verdict: ${report.verdict} suspectPages=${report.suspectPages.length === 0 ? "none" : report.suspectPages.join(",")}`,
  );
  io.write("Reading order and dropped text cannot be checked automatically; compare the review copy with the original PDF.");
  io.write("OCR is not run.");

  if (args.writeReview) {
    try {
      await mkdir(storage.realDataRoot, { recursive: true });
      await atomicReplaceFile({
        allowedRoot: storage.realDataRoot,
        bytes: new TextEncoder().encode(reviewText(args.file, sha256, pages, report)),
        relativePath: `review/${sha256}/pages.txt`,
        ...(dependencies.operations === undefined ? {} : { operations: dependencies.operations }),
      });
    } catch {
      return reject(io, "REVIEW_WRITE_FAILED", "The review copy could not be written.");
    }
    io.write(`Review copy: data/real/review/${sha256}/pages.txt (local only, not tracked by Git)`);
  }
  return 0;
}