import { afterEach, describe, expect, it, vi } from "vitest";

import { createPdfjsTextExtractor, type PdfjsModule } from "./pdfjsTextExtractor.js";

// Builds a tiny, valid, ASCII-only PDF from fictional text. A null page has an
// empty content stream, i.e. no text layer.
function escapePdfText(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function buildPdf(pageTexts: ReadonlyArray<string | null>): Uint8Array {
  const kids = pageTexts.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pageTexts.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  pageTexts.forEach((text, index) => {
    const stream = text === null ? "" : `BT /F1 12 Tf 20 100 Td (${escapePdfText(text)}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

function namedError(name: string): Error {
  const error = new Error("placeholder");
  error.name = name;
  return error;
}

function fakePdfjs(document: {
  numPages?: number;
  rejectWith?: Error;
  getPageError?: Error;
  texts?: readonly string[];
}): { module: PdfjsModule; destroyed: () => number } {
  let destroyed = 0;
  const module: PdfjsModule = {
    getDocument: () => ({
      promise:
        document.rejectWith !== undefined
          ? Promise.reject(document.rejectWith)
          : Promise.resolve({
              numPages: document.numPages ?? document.texts?.length ?? 0,
              getPage: async (number: number) => {
                if (document.getPageError !== undefined) {
                  throw document.getPageError;
                }
                return {
                  getTextContent: async () => ({ items: [{ str: document.texts?.[number - 1] ?? "", hasEOL: false }] }),
                  cleanup: () => undefined,
                };
              },
              destroy: async () => {
                destroyed += 1;
              },
            }),
    }),
  };
  return { module, destroyed: () => destroyed };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPdfjsTextExtractor with the installed pdfjs-dist", () => {
  it("returns the text layer page by page, in order", async () => {
    const extractor = createPdfjsTextExtractor();
    const pdf = buildPdf(["Alpha page one text", "Bravo page two text", "Charlie page three text"]);

    const result = await extractor.extract(pdf);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.map((page) => page.trim())).toEqual([
      "Alpha page one text",
      "Bravo page two text",
      "Charlie page three text",
    ]);
  });

  it("returns an empty text for a page without a text layer", async () => {
    const result = await createPdfjsTextExtractor().extract(buildPdf(["First page text", null, "Third page text"]));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toHaveLength(3);
    expect(result.value[1]?.trim()).toBe("");
    expect(result.value[0]?.trim()).toBe("First page text");
  });

  it("copies the input so the caller's buffer stays intact", async () => {
    const pdf = buildPdf(["Some text"]);
    const before = Array.from(pdf);

    await createPdfjsTextExtractor().extract(pdf);

    expect(Array.from(pdf)).toEqual(before);
    expect(pdf.byteLength).toBe(before.length);
  });

  it("reports corrupt or empty data as PDF_CORRUPT", async () => {
    const extractor = createPdfjsTextExtractor();

    const garbage = await extractor.extract(new TextEncoder().encode("this is not a pdf document"));
    const empty = await extractor.extract(new Uint8Array(0));

    expect(!garbage.ok && garbage.error.code).toBe("PDF_CORRUPT");
    expect(!empty.ok && empty.error.code).toBe("PDF_CORRUPT");
  });

  it("applies the size and page limits", async () => {
    const pdf = buildPdf(["One", "Two", "Three"]);

    const tooLarge = await createPdfjsTextExtractor({ maxBytes: 10 }).extract(pdf);
    const tooMany = await createPdfjsTextExtractor({ maxPages: 2 }).extract(pdf);

    expect(!tooLarge.ok && tooLarge.error.code).toBe("PDF_TOO_LARGE");
    expect(!tooMany.ok && tooMany.error.code).toBe("PDF_TOO_MANY_PAGES");
  });

  it("does not log anything", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];

    await createPdfjsTextExtractor().extract(buildPdf(["Quiet text"]));
    await createPdfjsTextExtractor().extract(new TextEncoder().encode("garbage"));

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe("createPdfjsTextExtractor error classification", () => {
  const bytes = new Uint8Array([1, 2, 3]);

  it("maps a password request to PDF_ENCRYPTED", async () => {
    const { module } = fakePdfjs({ rejectWith: namedError("PasswordException") });

    const result = await createPdfjsTextExtractor({ loadPdfjs: async () => module }).extract(bytes);

    expect(!result.ok && result.error.code).toBe("PDF_ENCRYPTED");
  });

  it.each(["InvalidPDFException", "FormatError", "MissingPDFException", "SomethingElse"])(
    "maps %s to PDF_CORRUPT",
    async (name) => {
      const { module } = fakePdfjs({ rejectWith: namedError(name) });

      const result = await createPdfjsTextExtractor({ loadPdfjs: async () => module }).extract(bytes);

      expect(!result.ok && result.error.code).toBe("PDF_CORRUPT");
    },
  );

  it("maps a document without pages to PDF_NO_PAGES and still releases it", async () => {
    const { module, destroyed } = fakePdfjs({ numPages: 0 });

    const result = await createPdfjsTextExtractor({ loadPdfjs: async () => module }).extract(bytes);

    expect(!result.ok && result.error.code).toBe("PDF_NO_PAGES");
    expect(destroyed()).toBe(1);
  });

  it("maps a page failure to PDF_CORRUPT and still releases the document", async () => {
    const { module, destroyed } = fakePdfjs({ numPages: 2, getPageError: namedError("FormatError") });

    const result = await createPdfjsTextExtractor({ loadPdfjs: async () => module }).extract(bytes);

    expect(!result.ok && result.error.code).toBe("PDF_CORRUPT");
    expect(destroyed()).toBe(1);
  });

  it("joins text items and honours end-of-line markers", async () => {
    const module: PdfjsModule = {
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            getTextContent: async () => ({ items: [{ str: "one", hasEOL: true }, { str: "two", hasEOL: false }, { type: "marker" }] }),
            cleanup: () => undefined,
          }),
          destroy: async () => undefined,
        }),
      }),
    };

    const result = await createPdfjsTextExtractor({ loadPdfjs: async () => module }).extract(bytes);

    expect(result.ok && result.value).toEqual(["one\ntwo"]);
  });
});