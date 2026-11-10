import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadRegistry, sha256Hex, type RegisteredCandidate } from "@ehime-vote-navigator/domain";
import { describe, expect, it } from "vitest";

import { withTemporaryTestDirectory } from "../../../../tests/harness/temporary-directory.js";
import { createFileStageStore } from "../analysis/stageStore.js";
import type { PdfTextExtractor } from "./pdfTextExtractor.js";
import { INJECTED_EXTRACTOR_ID, extractAndStore, loadStoredExtraction } from "./storedExtraction.js";

const BYTES_MARKER = "RAW-PDF-BYTES-MARKER";
const BYTES = new TextEncoder().encode(`%PDF-1.4\n% ${BYTES_MARKER}\n%%EOF\n`);
const SHA = sha256Hex(BYTES);

// Obviously fictional placeholders; no real candidate appears here.
function candidatesOf(letters: readonly string[]): readonly RegisteredCandidate[] {
  const loaded = loadRegistry({
    schemaVersion: 1,
    elections: [
      {
        electionId: "test-election-a",
        name: "Test Election A",
        electionDate: "2026-11-15",
        status: "CURRENT",
        candidates: letters.map((letter) => ({
          candidateId: `candidate-${letter}`,
          name: `Test Candidate ${letter.toUpperCase()}`,
          nameForms: [`Test Candidate ${letter.toUpperCase()}`],
        })),
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

function clock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 10, 5, 0, 0, tick++));
}

const PAGES = ["Intro text.", "Test Candidate A describes a plan.", "", "Test Candidate A and Test Candidate B."];

function request(base: string, extractor: PdfTextExtractor, overrides: Record<string, unknown> = {}) {
  return {
    bytes: BYTES,
    candidates: candidatesOf(["a", "b"]),
    extractor,
    extractorId: INJECTED_EXTRACTOR_ID,
    now: clock(),
    revision: "r1",
    sourceId: "bulletin-a",
    sourceSha256: SHA,
    store: createFileStageStore({ realDataRoot: base }),
    ...overrides,
  };
}

describe("extractAndStore", () => {
  it("keeps the page numbers, the SHA-256 and the revision, and saves no PDF bytes", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const extractor = fakeExtractor(PAGES);
      const input = request(base, extractor);

      const result = await extractAndStore(input);

      expect(result.ok && result.value.cached).toBe(false);
      const files = await readdir(join(base, "stages", SHA, "r1", "EXTRACT"));
      expect(files).toHaveLength(1);
      const text = await readFile(join(base, "stages", SHA, "r1", "EXTRACT", files[0] ?? ""), "utf8");
      const stored = JSON.parse(text) as {
        key: Record<string, unknown>;
        output: { pages: Array<{ page: number }>; imagePages: number[]; passages: Array<{ page: number }> };
        status: string;
      };
      expect(stored.status).toBe("SUCCEEDED");
      expect(stored.key).toMatchObject({ sourceSha256: SHA, revision: "r1", stage: "EXTRACT", modelId: null });
      expect(stored.output.pages.map((page) => page.page)).toEqual([1, 2, 3, 4]);
      expect(stored.output.imagePages).toEqual([3]);
      expect(stored.output.passages.every((passage) => passage.page >= 1 && passage.page <= 4)).toBe(true);
      expect(text).not.toContain(BYTES_MARKER);
      expect(sha256Hex(BYTES)).toBe(SHA);
    }, "stored-extraction-save");
  });

  it("serves the same key from the store without extracting again", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const extractor = fakeExtractor(PAGES);

      const first = await extractAndStore(request(base, extractor));
      const second = await extractAndStore(request(base, extractor));

      expect(first.ok && second.ok && second.value.cached).toBe(true);
      expect(first.ok && second.ok && second.value.stageRunId).toBe(first.ok ? first.value.stageRunId : "");
      expect(second.ok && second.value.output).toEqual(first.ok ? first.value.output : null);
      expect(extractor.calls()).toBe(1);
      expect(await readdir(join(base, "stages", SHA, "r1", "EXTRACT"))).toHaveLength(1);
    }, "stored-extraction-cache");
  });

  it("makes a new run when the registered candidates or the engine change", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const extractor = fakeExtractor(PAGES);
      await extractAndStore(request(base, extractor));

      const fewer = await extractAndStore(request(base, extractor, { candidates: candidatesOf(["a"]) }));
      const otherEngine = await extractAndStore(request(base, extractor, { extractorId: "pdfjs-dist@0.0.0" }));

      expect(fewer.ok && fewer.value.cached).toBe(false);
      expect(otherEngine.ok && otherEngine.value.cached).toBe(false);
      expect(extractor.calls()).toBe(3);
      expect(await readdir(join(base, "stages", SHA, "r1", "EXTRACT"))).toHaveLength(3);
    }, "stored-extraction-inputs");
  });

  it("stores a document that cannot be read as a completed NOT_READY run", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const result = await extractAndStore(request(base, fakeExtractor(["", " "])));
      const loaded = await loadStoredExtraction(createFileStageStore({ realDataRoot: base }), {
        revision: "r1",
        sourceSha256: SHA,
      });

      expect(result.ok && result.value.output.notReady).toBe("ALL_PAGES_IMAGE");
      expect(loaded.ok && loaded.value?.notReady).toBe("ALL_PAGES_IMAGE");
      expect(loaded.ok && loaded.value?.pages).toEqual([]);
    }, "stored-extraction-not-ready");
  });

  it("loads the newest stored extraction of a revision, or null when there is none", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const store = createFileStageStore({ realDataRoot: base });
      expect(await loadStoredExtraction(store, { revision: "r1", sourceSha256: SHA })).toEqual({ ok: true, value: null });
      const now = clock();
      await extractAndStore(request(base, fakeExtractor(["old page"]), { now }));
      await extractAndStore(request(base, fakeExtractor(["new page"]), { now, extractorId: "pdfjs-dist@0.0.0" }));

      const loaded = await loadStoredExtraction(store, { revision: "r1", sourceSha256: SHA });

      expect(loaded.ok && loaded.value?.pages.map((page) => page.text)).toEqual(["new page"]);
      expect(await loadStoredExtraction(store, { revision: "bad", sourceSha256: SHA })).toEqual({
        ok: false,
        error: { code: "INVALID_RUN" },
      });
    }, "stored-extraction-load");
  });

  it("refuses bytes that do not match the SHA-256 or an invalid revision, and extracts nothing", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const extractor = fakeExtractor(PAGES);

      const wrongSha = await extractAndStore(request(base, extractor, { sourceSha256: "0".repeat(64) }));
      const wrongRevision = await extractAndStore(request(base, extractor, { revision: "../r1" }));

      expect(wrongSha).toEqual({ ok: false, error: { code: "INVALID_REQUEST" } });
      expect(wrongRevision).toEqual({ ok: false, error: { code: "INVALID_REQUEST" } });
      expect(extractor.calls()).toBe(0);
      expect(await readdir(base)).toEqual([]);
    }, "stored-extraction-invalid");
  });

  it("reports a failed save and leaves no partial file", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const store = createFileStageStore({
        realDataRoot: base,
        operations: {
          rename: async () => {
            throw new Error("rename blocked");
          },
        },
      });

      const result = await extractAndStore(request(base, fakeExtractor(PAGES), { store }));

      expect(result).toEqual({ ok: false, error: { code: "STORE_WRITE_FAILED" } });
      expect(await readdir(join(base, "stages", SHA, "r1", "EXTRACT"))).toEqual([]);
    }, "stored-extraction-write-fail");
  });
});