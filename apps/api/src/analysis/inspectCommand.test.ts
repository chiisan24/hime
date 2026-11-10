import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { sha256Hex } from "@ehime-vote-navigator/domain";
import { describe, expect, it } from "vitest";

import { withTemporaryTestDirectory } from "../../../../tests/harness/temporary-directory.js";
import type { PdfError, PdfTextExtractor } from "../extract/pdfTextExtractor.js";
import { runAnalysisCli } from "./cli.js";

const MARKER = "SECRET-PAGE-TEXT-MARKER";
const BODY = new TextEncoder().encode("%PDF-1.4\n% placeholder\n%%EOF\n");
const SENTENCE = "これは架空の公報の文章であり、教育や防災について述べています。";

async function createWorkspace(base: string): Promise<string> {
  const root = join(base, "workspace");
  await mkdir(join(root, "data", "real", "raw"), { recursive: true });
  await writeFile(join(root, "data", "real", "raw", "bulletin.pdf"), BODY);
  return root;
}

function createIo() {
  const lines: string[] = [];
  return {
    lines,
    io: { write: (line: string) => { lines.push(line); }, confirm: async () => false },
  };
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

describe("analysis CLI: inspect", () => {
  it("prints per-page counts and a verdict, never the text, and writes nothing", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { io, lines } = createIo();
      const extractor = fakeExtractor([`${SENTENCE.repeat(5)}${MARKER}`, SENTENCE.repeat(5)]);

      const code = await runAnalysisCli(["inspect", "--file", "bulletin.pdf"], { workspaceRoot: root, io, extractor });

      expect(code).toBe(0);
      expect(lines[0]).toBe(`Inspect: file=bulletin.pdf bytes=${BODY.byteLength} sha256=${sha256Hex(BODY)} pages=2`);
      expect(lines[1]).toMatch(/^Page 1: chars=\d+ lines=1 kanji=\d+ hiragana=\d+ .*flags=none$/u);
      expect(lines[2]).toMatch(/^Page 2: chars=\d+ /u);
      expect(lines.some((line) => line.startsWith("Structure (approximate): images=0 fonts=0"))).toBe(true);
      expect(lines).toContain("Verdict: TEXT_LAYER_PLAUSIBLE suspectPages=none");
      expect(lines).toContain("OCR is not run.");
      expect(lines.join("\n")).not.toContain(MARKER);
      expect(lines.join("\n")).not.toContain("架空");
      expect(lines.join("\n")).not.toContain(root);
      expect(await readdir(join(root, "data", "real"))).toEqual(["raw"]);
    }, "inspect-counts");
  });

  it("flags pages without text and recommends review or OCR", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { io, lines } = createIo();

      const code = await runAnalysisCli(["inspect", "--file", "bulletin.pdf"], {
        workspaceRoot: root,
        io,
        extractor: fakeExtractor(["", "abc"]),
      });

      expect(code).toBe(0);
      expect(lines[1]).toContain("flags=NO_TEXT_LAYER");
      expect(lines[2]).toContain("flags=SPARSE_TEXT");
      expect(lines).toContain("Verdict: REVIEW_OR_OCR_RECOMMENDED suspectPages=1,2");
    }, "inspect-verdict");
  });

  it("writes a local review copy only on request and leaves the PDF unchanged", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { io, lines } = createIo();
      const sha256 = sha256Hex(BODY);

      const code = await runAnalysisCli(["inspect", "--file", "bulletin.pdf", "--write-review"], {
        workspaceRoot: root,
        io,
        extractor: fakeExtractor([`${SENTENCE}${MARKER}`, "second page"]),
      });

      expect(code).toBe(0);
      const review = await readFile(join(root, "data", "real", "review", sha256, "pages.txt"), "utf8");
      expect(review).toContain("===== Page 1 (");
      expect(review).toContain(MARKER);
      expect(review).toContain("===== Page 2 (");
      expect(lines.at(-1)).toBe(`Review copy: data/real/review/${sha256}/pages.txt (local only, not tracked by Git)`);
      expect(lines.join("\n")).not.toContain(MARKER);
      expect(sha256Hex(await readFile(join(root, "data", "real", "raw", "bulletin.pdf")))).toBe(sha256);
    }, "inspect-review");
  });

  it("reports a failed review write without leaving a file", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { io, lines } = createIo();

      const code = await runAnalysisCli(["inspect", "--file", "bulletin.pdf", "--write-review"], {
        workspaceRoot: root,
        io,
        extractor: fakeExtractor(["page"]),
        stageOperations: { rename: async () => { throw new Error("rename blocked"); } },
      });

      expect(code).toBe(1);
      expect(lines).toContain("Inspect rejected: REVIEW_WRITE_FAILED");
      expect(await readdir(join(root, "data", "real", "review", sha256Hex(BODY)))).toEqual([]);
    }, "inspect-review-fail");
  });

  it.each([["../bulletin.pdf"], ["sub/bulletin.pdf"], ["sub\\bulletin.pdf"], ["bulletin.txt"], ["a..pdf"], [".pdf"]])(
    "rejects the file name %s without reading or extracting",
    async (name) => {
      await withTemporaryTestDirectory(async (base) => {
        const root = await createWorkspace(base);
        const { io, lines } = createIo();
        const extractor = fakeExtractor(["page"]);

        const code = await runAnalysisCli(["inspect", "--file", name], { workspaceRoot: root, io, extractor });

        expect(code).toBe(1);
        expect(lines[0]).toBe("Inspect rejected: INVALID_FILE_NAME");
        expect(extractor.calls()).toBe(0);
      }, "inspect-name");
    },
  );

  it("reports a missing file and an unreadable PDF by code", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const missing = createIo();
      const encrypted = createIo();
      const failing: PdfTextExtractor = {
        extract: async () => ({ ok: false, error: { code: "PDF_ENCRYPTED" } satisfies PdfError }),
      };

      const first = await runAnalysisCli(["inspect", "--file", "absent.pdf"], { workspaceRoot: root, io: missing.io, extractor: fakeExtractor([]) });
      const second = await runAnalysisCli(["inspect", "--file", "bulletin.pdf"], { workspaceRoot: root, io: encrypted.io, extractor: failing });

      expect([first, second]).toEqual([1, 1]);
      expect(missing.lines[0]).toBe("Inspect rejected: RAW_FILE_UNREADABLE");
      expect(encrypted.lines[0]).toBe("Inspect rejected: PDF_ENCRYPTED");
    }, "inspect-errors");
  });

  it.each([
    [["inspect"]],
    [["inspect", "--file"]],
    [["inspect", "--write-review"]],
    [["inspect", "bulletin.pdf"]],
    [["inspect", "--file", "a.pdf", "--file", "b.pdf"]],
    [["inspect", "--file", "a.pdf", "--write-review", "--write-review"]],
    [["inspect", "--file", "a.pdf", "--unknown"]],
  ])("prints the usage and exits 1 for %j", async (argv) => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { io, lines } = createIo();

      const code = await runAnalysisCli(argv, { workspaceRoot: root, io, extractor: fakeExtractor(["page"]) });

      expect(code).toBe(1);
      expect(lines[0]).toBe("Usage: npm run analysis -- <command>");
    }, "inspect-usage");
  });
});