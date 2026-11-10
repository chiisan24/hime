import { ExtractionOutputSchema } from "@ehime-vote-navigator/contracts";
import { loadRegistry, sha256Hex, type RegisteredCandidate } from "@ehime-vote-navigator/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_PDF_BYTES, MAX_PDF_PAGES, type PdfError, type PdfTextExtractor } from "./pdfTextExtractor.js";
import { runExtractStage } from "./extractStage.js";

const MARKER = "SECRET-PAGE-TEXT-MARKER";

// Obviously fictional placeholders; no real candidate appears here.
function candidates(): readonly RegisteredCandidate[] {
  const loaded = loadRegistry({
    schemaVersion: 1,
    elections: [
      {
        electionId: "test-election-a",
        name: "Test Election A",
        electionDate: "2026-11-15",
        status: "CURRENT",
        candidates: [
          { candidateId: "candidate-a", name: "Test Candidate A", nameForms: ["Test Candidate A"] },
          { candidateId: "candidate-b", name: "Test Candidate B", nameForms: ["Test Candidate B"] },
        ],
      },
    ],
  });
  if (!loaded.ok) {
    throw new Error("fixture registry invalid");
  }
  return loaded.value.elections[0]?.candidates ?? [];
}

function fakeExtractor(pages: readonly string[]): PdfTextExtractor & { calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    extract: async () => {
      calls += 1;
      return { ok: true, value: pages };
    },
  };
}

function failingExtractor(error: PdfError): PdfTextExtractor & { calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    extract: async () => {
      calls += 1;
      return { ok: false, error };
    },
  };
}

const BYTES = new TextEncoder().encode("%PDF-1.4 placeholder bytes");

function input(extractor: PdfTextExtractor, overrides: Record<string, unknown> = {}) {
  return { bytes: BYTES, candidates: candidates(), extractor, revision: "r1", sourceId: "bulletin-a", ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runExtractStage", () => {
  it("returns page texts with 1-based numbers, passages with locators and candidate evidence", async () => {
    const pages = [
      "Opening remarks.\u3002",
      `Test Candidate A will build things.\u3002 ${MARKER}`,
      "Test Candidate A and Test Candidate B appear together.",
    ];

    const output = await runExtractStage(input(fakeExtractor(pages)));

    expect(ExtractionOutputSchema.safeParse(output).success).toBe(true);
    expect(output.notReady).toBeNull();
    expect(output.pageCount).toBe(3);
    expect(output.imagePages).toEqual([]);
    expect(output.pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(output.pages.map((p) => p.text)).toEqual(pages);
    const byId = Object.fromEntries(output.passages.map((p) => [p.passageId, p]));
    expect(Object.keys(byId)[0]).toBe("bulletin-a:r1:p1:0");
    const assigned = output.passages.filter((p) => p.assignment.state === "ASSIGNED");
    expect(assigned.map((p) => [p.page, p.assignment.state === "ASSIGNED" ? p.assignment.candidateId : "", p.evidence?.nameForm])).toEqual([
      [2, "candidate-a", "Test Candidate A"],
    ]);
    expect(output.passages.filter((p) => p.page === 3).every((p) => p.assignment.state === "UNASSIGNED" || p.evidence !== null)).toBe(true);
    for (const passage of output.passages) {
      expect(passage.textSha256).toBe(sha256Hex(passage.text));
      expect(pages[passage.page - 1]?.slice(passage.charStart, passage.charEnd)).toBe(passage.text);
    }
  });

  it("records pages without a text layer as image pages and analyses only the rest", async () => {
    const output = await runExtractStage(input(fakeExtractor(["Some text here.", "  \n ", "More text here."])));

    expect(output.notReady).toBeNull();
    expect(output.imagePages).toEqual([2]);
    expect(output.pages.map((p) => p.text)).toEqual(["Some text here.", "", "More text here."]);
    expect(output.passages.map((p) => p.page)).toEqual([1, 3]);
  });

  it("is NOT_READY with no pages or passages when every page is an image", async () => {
    const extractor = fakeExtractor(["", " ", "\n"]);

    const output = await runExtractStage(input(extractor));

    expect(output).toMatchObject({ notReady: "ALL_PAGES_IMAGE", pageCount: 3, imagePages: [1, 2, 3], pages: [], passages: [] });
    expect(extractor.calls()).toBe(1);
  });

  it.each(["PDF_CORRUPT", "PDF_ENCRYPTED", "PDF_NO_PAGES", "PDF_TOO_LARGE", "PDF_TOO_MANY_PAGES"] as const)(
    "turns the extractor error %s into NOT_READY without content",
    async (code) => {
      const output = await runExtractStage(input(failingExtractor({ code })));

      expect(output).toMatchObject({ notReady: code, pages: [], passages: [] });
    },
  );

  it("does not call the extractor for an oversized document", async () => {
    const extractor = fakeExtractor(["text"]);

    const output = await runExtractStage(input(extractor, { bytes: new Uint8Array(MAX_PDF_BYTES + 1) }));

    expect(output.notReady).toBe("PDF_TOO_LARGE");
    expect(extractor.calls()).toBe(0);
  });

  it("rejects a document with no pages and one with too many pages", async () => {
    const none = await runExtractStage(input(fakeExtractor([])));
    const many = await runExtractStage(input(fakeExtractor(Array.from({ length: MAX_PDF_PAGES + 1 }, () => "text"))));

    expect(none.notReady).toBe("PDF_NO_PAGES");
    expect(many).toMatchObject({ notReady: "PDF_TOO_MANY_PAGES", pages: [], passages: [] });
  });

  it("treats a throwing extractor as a corrupt document", async () => {
    const output = await runExtractStage(
      input({ extract: async () => { throw new Error(MARKER); } }),
    );

    expect(output.notReady).toBe("PDF_CORRUPT");
    expect(JSON.stringify(output)).not.toContain(MARKER);
  });

  it("is deterministic and never logs", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    const pages = [`Test Candidate B says hello.\u3002${MARKER}`];

    const first = await runExtractStage(input(fakeExtractor(pages)));
    const second = await runExtractStage(input(fakeExtractor(pages)));

    expect(second).toEqual(first);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});