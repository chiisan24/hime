import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createCanvas } from "@napi-rs/canvas";
import { sha256Hex, type Result } from "@ehime-vote-navigator/domain";
import { describe, expect, it } from "vitest";

import { withTemporaryTestDirectory } from "../../../../tests/harness/temporary-directory.js";
import {
  FULL_PAGE,
  type OcrError,
  type OcrLine,
  type OcrSession,
  type PageImage,
  type PageRasterizer,
  type RasterizeRequest,
} from "../ocr/ocrTypes.js";
import { runAnalysisCli } from "./cli.js";

const MARKER = "SECRET-BODY-MARKER";
const BODY = new TextEncoder().encode("%PDF-1.4\n% placeholder\n%%EOF\n");
const SHA = sha256Hex(BODY);
const TRIAL = ["data", "real", "ocr", SHA, "trial"];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

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

function fakeRasterizer(failWith?: "PDF_CORRUPT") {
  const requests: RasterizeRequest[] = [];
  const rasterizer: PageRasterizer = {
    rasterize: async (_bytes, wanted) => {
      requests.push(...wanted);
      if (failWith !== undefined) {
        return { ok: false, error: { code: failWith } };
      }
      const canvas = createCanvas(120, 60);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 120, 60);
      const png = new Uint8Array(canvas.toBuffer("image/png"));
      const images: PageImage[] = wanted.map((request) => ({
        dpi: request.dpi ?? 300,
        height: 60,
        page: request.page,
        png,
        region: request.region ?? FULL_PAGE,
        width: 120,
      }));
      return { ok: true, value: images };
    },
  };
  return { rasterizer, requests };
}

function fakeSession(options: { fail?: OcrError["code"]; start?: OcrError["code"] } = {}) {
  const state = { closed: 0 };
  const createOcrSession = async (): Promise<Result<OcrSession, OcrError>> => {
    if (options.start !== undefined) {
      return { ok: false, error: { code: options.start } };
    }
    return {
      ok: true,
      value: {
        close: async () => { state.closed += 1; },
        engine: {
          id: "fake-ocr@1",
          recognize: async (image) => {
            if (options.fail !== undefined) {
              return { ok: false, error: { code: options.fail } };
            }
            const spanX = image.region.x1 - image.region.x0;
            const spanY = image.region.y1 - image.region.y0;
            const box = (x0: number, y0: number, x1: number, y1: number) => ({
              x0: image.region.x0 + x0 * spanX,
              x1: image.region.x0 + x1 * spanX,
              y0: image.region.y0 + y0 * spanY,
              y1: image.region.y0 + y1 * spanY,
            });
            const lines: OcrLine[] = [
              { box: box(0.1, 0.1, 0.9, 0.2), confidence: 0.9, orientation: "horizontal", text: `ALPHA-${MARKER}` },
              { box: box(0.8, 0.3, 0.9, 0.9), confidence: 0.6, orientation: "vertical", text: "縦書きの例" },
            ];
            return { ok: true, value: lines };
          },
        },
        networkAttempts: () => 0,
      },
    };
  };
  return { createOcrSession, state };
}

const TRIAL_ARGS = ["ocr", "trial", "--file", "bulletin.pdf", "--region", "A=1:0.1,0.1,0.6,0.5", "--region", "B=2:0.2,0.2,0.7,0.6"];
const CORRECT_TEXT = `ALPHA-${MARKER}\n縦書きの例`;

type TrialJson = {
  regions: Array<{ groundTruth: string; id: string; lines: Array<{ n: number; text: string }> }>;
} & Record<string, unknown>;

async function readJson(root: string, name: string): Promise<TrialJson> {
  return JSON.parse(await readFile(join(root, ...TRIAL, name), "utf8")) as TrialJson;
}

async function typeGroundTruth(root: string, texts: Record<string, string>): Promise<void> {
  const truth = await readJson(root, "ground-truth.json");
  for (const region of truth.regions) {
    region.groundTruth = texts[region.id] ?? "";
  }
  await writeFile(join(root, ...TRIAL, "ground-truth.json"), JSON.stringify(truth));
}

describe("analysis CLI: ocr trial", () => {
  it("prints counts only and saves images, results and an empty ground-truth template", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { io, lines } = createIo();
      const { rasterizer, requests } = fakeRasterizer();
      const { createOcrSession, state } = fakeSession();

      const code = await runAnalysisCli(TRIAL_ARGS, { workspaceRoot: root, io, rasterizer, createOcrSession });

      expect(code).toBe(0);
      expect(requests).toEqual([
        { dpi: 300, page: 1, region: { x0: 0.1, x1: 0.6, y0: 0.1, y1: 0.5 } },
        { dpi: 300, page: 2, region: { x0: 0.2, x1: 0.7, y0: 0.2, y1: 0.6 } },
      ]);
      expect(lines[0]).toMatch(
        new RegExp(`^OCR trial: file=bulletin.pdf sha256=${SHA} engine=fake-ocr@1 dpi=300 strategy=per-line config=per-line-300dpi regions=2 textLayerUsed=false networkAttempts=0 renderMs=\\d+ modelLoadMs=\\d+ recognizeMs=\\d+ peakRssMb=\\d+$`, "u"),
      );
      expect(lines[1]).toMatch(
        /^Region A: page=1 box=0\.100,0\.100,0\.600,0\.500 image=120x60 lines=2 horizontal=1 vertical=1 meanConfidence=0\.75 minConfidence=0\.60 lowConfidence=1 recognizeMs=\d+$/u,
      );
      expect(lines[2]).toMatch(/^Region B: page=2 /u);
      expect(lines[3]).toBe(`Files: data/real/ocr/${SHA}/trial/ (local only, not tracked by Git)`);
      expect(lines[4]).toMatch(/^ground-truth.json is empty/u);
      expect(lines.join("\n")).not.toContain(MARKER);
      expect(lines.join("\n")).not.toContain("縦書き");
      expect(lines.join("\n")).not.toContain(root);
      expect(state.closed).toBe(1);

      const names = await readdir(join(root, ...TRIAL));
      expect(names.sort()).toEqual([
        "ground-truth.json", "ocr-results.json",
        "region-A-ocr.txt", "region-A-overlay.png", "region-A.png",
        "region-B-ocr.txt", "region-B-overlay.png", "region-B.png",
      ]);
      const image = await readFile(join(root, ...TRIAL, "region-A.png"));
      const overlay = await readFile(join(root, ...TRIAL, "region-A-overlay.png"));
      expect([...image.subarray(0, 4)]).toEqual(PNG_MAGIC);
      expect([...overlay.subarray(0, 4)]).toEqual(PNG_MAGIC);
      expect(overlay.equals(image)).toBe(false);

      const results = await readJson(root, "ocr-results.json");
      expect(results).toMatchObject({ engine: "fake-ocr@1", file: "bulletin.pdf", sha256: SHA, textLayerUsed: false });
      expect(results.regions[0]?.lines.map((line) => [line.n, line.text])).toEqual([[1, `ALPHA-${MARKER}`], [2, "縦書きの例"]]);
      expect(await readFile(join(root, ...TRIAL, "region-A-ocr.txt"), "utf8")).toBe(
        `001 [H 0.90] ALPHA-${MARKER}\n002 [V 0.60] 縦書きの例\n`,
      );

      const text = await readFile(join(root, ...TRIAL, "ground-truth.json"), "utf8");
      expect(text).not.toContain(MARKER);
      expect(JSON.parse(text).regions.map((region: { groundTruth: string; id: string }) => [region.id, region.groundTruth])).toEqual([["A", ""], ["B", ""]]);
    }, "ocr-trial");
  });

  it("never overwrites a ground-truth file that already exists", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const options = { workspaceRoot: root, rasterizer: fakeRasterizer().rasterizer, createOcrSession: fakeSession().createOcrSession };
      await runAnalysisCli(TRIAL_ARGS, { ...options, io: createIo().io });
      await typeGroundTruth(root, { A: "typed by a person" });
      const before = await readFile(join(root, ...TRIAL, "ground-truth.json"), "utf8");
      const { io, lines } = createIo();

      const code = await runAnalysisCli(TRIAL_ARGS, { ...options, io });

      expect(code).toBe(0);
      expect(lines.at(-1)).toBe("ground-truth.json already exists and was left unchanged.");
      expect(await readFile(join(root, ...TRIAL, "ground-truth.json"), "utf8")).toBe(before);
    }, "ocr-trial-keep");
  });

  it.each([
    ["no region", ["ocr", "trial", "--file", "bulletin.pdf"]],
    ["no file", ["ocr", "trial", "--region", "A=1:0.1,0.1,0.5,0.5"]],
    ["a region larger than half a page", ["ocr", "trial", "--file", "bulletin.pdf", "--region", "A=1:0.1,0.1,0.9,0.9"]],
    ["page 0", ["ocr", "trial", "--file", "bulletin.pdf", "--region", "A=0:0,0,0.5,0.5"]],
    ["an inverted region", ["ocr", "trial", "--file", "bulletin.pdf", "--region", "A=1:0.5,0.1,0.4,0.5"]],
    ["a region outside the page", ["ocr", "trial", "--file", "bulletin.pdf", "--region", "A=1:0,0,1.5,0.2"]],
    ["a duplicate id", ["ocr", "trial", "--file", "bulletin.pdf", "--region", "A=1:0,0,0.2,0.2", "--region", "A=2:0,0,0.2,0.2"]],
    ["six regions", ["ocr", "trial", "--file", "bulletin.pdf", ...["A", "B", "C", "D", "E", "F"].flatMap((id) => ["--region", `${id}=1:0,0,0.2,0.2`])]],
    ["an unknown flag", ["ocr", "trial", "--file", "bulletin.pdf", "--region", "A=1:0,0,0.2,0.2", "--all", "yes"]],
    ["a bad dpi", ["ocr", "trial", "--file", "bulletin.pdf", "--region", "A=1:0,0,0.2,0.2", "--dpi", "x"]],
    ["no action", ["ocr"]],
    ["an unknown action", ["ocr", "run"]],
    ["compare without a file", ["ocr", "compare"]],
    ["compare with a bad minimum", ["ocr", "compare", "--file", "bulletin.pdf", "--min-f1", "2"]],
  ])("prints the usage and exits 1 for %s", async (_label, argv) => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { io, lines } = createIo();
      const { rasterizer, requests } = fakeRasterizer();

      const code = await runAnalysisCli(argv, { workspaceRoot: root, io, rasterizer, createOcrSession: fakeSession().createOcrSession });

      expect(code).toBe(1);
      expect(lines[0]).toBe("Usage: npm run analysis -- <command>");
      expect(requests).toEqual([]);
    }, "ocr-usage");
  });

  it("rejects an unsafe or missing file without rendering", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const rejections: string[] = [];
      for (const name of ["../bulletin.pdf", "sub/bulletin.pdf", "bulletin.txt", "absent.pdf"]) {
        const { io, lines } = createIo();
        const { rasterizer, requests } = fakeRasterizer();
        const code = await runAnalysisCli(["ocr", "trial", "--file", name, "--region", "A=1:0,0,0.2,0.2"], { workspaceRoot: root, io, rasterizer, createOcrSession: fakeSession().createOcrSession });
        expect(code).toBe(1);
        expect(requests).toEqual([]);
        rejections.push(lines[0] ?? "");
      }
      expect(rejections).toEqual([
        "OCR trial rejected: INVALID_FILE_NAME",
        "OCR trial rejected: INVALID_FILE_NAME",
        "OCR trial rejected: INVALID_FILE_NAME",
        "OCR trial rejected: RAW_FILE_UNREADABLE",
      ]);
    }, "ocr-trial-files");
  });

  it.each([
    ["the page cannot be rendered", { rasterizer: fakeRasterizer("PDF_CORRUPT").rasterizer, session: fakeSession() }, "PDF_CORRUPT"],
    ["the engine cannot start", { rasterizer: fakeRasterizer().rasterizer, session: fakeSession({ start: "OCR_MODEL_INVALID" }) }, "OCR_MODEL_INVALID"],
    ["the recognition fails", { rasterizer: fakeRasterizer().rasterizer, session: fakeSession({ fail: "OCR_FAILED" }) }, "OCR_FAILED"],
  ])("saves nothing when %s", async (_label, parts, code) => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { io, lines } = createIo();

      const exit = await runAnalysisCli(TRIAL_ARGS, { workspaceRoot: root, io, rasterizer: parts.rasterizer, createOcrSession: parts.session.createOcrSession });

      expect(exit).toBe(1);
      expect(lines[0]).toBe(`OCR trial rejected: ${code}`);
      expect(await readdir(join(root, "data", "real"))).toEqual(["raw"]);
    }, "ocr-trial-failures");
  });

  it("closes the engine and reports TRIAL_WRITE_FAILED when the files cannot be written", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { io, lines } = createIo();
      const { createOcrSession, state } = fakeSession();

      const code = await runAnalysisCli(TRIAL_ARGS, {
        workspaceRoot: root, io, rasterizer: fakeRasterizer().rasterizer, createOcrSession,
        stageOperations: { rename: async () => { throw new Error("rename blocked"); } },
      });

      expect(code).toBe(1);
      expect(lines[0]).toBe("OCR trial rejected: TRIAL_WRITE_FAILED");
      expect(state.closed).toBe(1);
    }, "ocr-trial-write");
  });
});

describe("analysis CLI: ocr compare", () => {
  async function trial(root: string): Promise<void> {
    const code = await runAnalysisCli(TRIAL_ARGS, { workspaceRoot: root, io: createIo().io, rasterizer: fakeRasterizer().rasterizer, createOcrSession: fakeSession().createOcrSession });
    expect(code).toBe(0);
  }

  it("passes a region whose text matches and scores only the regions with typed text", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await trial(root);
      await typeGroundTruth(root, { A: CORRECT_TEXT });
      const { io, lines } = createIo();

      const code = await runAnalysisCli(["ocr", "compare", "--file", "bulletin.pdf"], { workspaceRoot: root, io });

      expect(code).toBe(0);
      expect(lines[0]).toMatch(/^Region A: referenceChars=\d+ ocrChars=\d+ cer=0.000 f1=1.000 recall=1.000 precision=1.000 result=PASS$/u);
      expect(lines[1]).toBe("OCR compare: regionsScored=1 passed=1 failed=0 minF1=0.95 verdict=ACCURATE_ENOUGH config=per-line-300dpi engine=fake-ocr@1");
      expect(lines[2]).toBe("The sample is accurate enough. Ask the owner before any full-document analysis.");
      expect(lines.join("\n")).not.toContain(MARKER);
      const comparison = await readFile(join(root, ...TRIAL, "comparison.json"), "utf8");
      expect(JSON.parse(comparison)).toMatchObject({ verdict: "ACCURATE_ENOUGH", minF1: 0.95 });
      expect(comparison).not.toContain(MARKER);
    }, "ocr-compare-pass");
  });

  it("fails a region that is not accurate enough and says the full document must not be analysed", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await trial(root);
      await typeGroundTruth(root, { A: CORRECT_TEXT, B: `ALPHA-${MARKER}\n全く別の文章です` });
      const { io, lines } = createIo();

      const code = await runAnalysisCli(["ocr", "compare", "--file", "bulletin.pdf"], { workspaceRoot: root, io });

      expect(code).toBe(1);
      expect(lines[1]).toMatch(/^Region B: .* result=FAIL$/u);
      expect(lines[2]).toBe("OCR compare: regionsScored=2 passed=1 failed=1 minF1=0.95 verdict=NOT_ACCURATE_ENOUGH config=per-line-300dpi engine=fake-ocr@1");
      expect(lines[3]).toBe("Full-document analysis must not start: the OCR is not accurate enough on this sample.");
    }, "ocr-compare-fail");
  });

  it("honours --min-f1 and flags a different reading order", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await trial(root);
      await typeGroundTruth(root, { A: "縦書きの例\nALPHA-" + MARKER });
      const { io, lines } = createIo();

      const code = await runAnalysisCli(["ocr", "compare", "--file", "bulletin.pdf", "--min-f1", "0.99"], { workspaceRoot: root, io });

      expect(code).toBe(0);
      expect(lines[0]).toMatch(/f1=1.000 .* result=PASS READING_ORDER_SUSPECT$/u);
    }, "ocr-compare-order");
  });

  it("stops when there is nothing to compare", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const before = createIo();
      await runAnalysisCli(["ocr", "compare", "--file", "bulletin.pdf"], { workspaceRoot: root, io: before.io });
      await trial(root);
      const empty = createIo();
      const emptyCode = await runAnalysisCli(["ocr", "compare", "--file", "bulletin.pdf"], { workspaceRoot: root, io: empty.io });
      const truth = await readJson(root, "ground-truth.json");
      await writeFile(join(root, ...TRIAL, "ground-truth.json"), JSON.stringify({ ...truth, sha256: "0".repeat(64) }));
      const other = createIo();
      await runAnalysisCli(["ocr", "compare", "--file", "bulletin.pdf"], { workspaceRoot: root, io: other.io });
      await writeFile(join(root, ...TRIAL, "ground-truth.json"), "{ not json");
      const broken = createIo();
      await runAnalysisCli(["ocr", "compare", "--file", "bulletin.pdf"], { workspaceRoot: root, io: broken.io });

      expect(before.lines[0]).toBe("OCR compare rejected: RESULTS_NOT_FOUND");
      expect(emptyCode).toBe(1);
      expect(empty.lines[0]).toBe("OCR compare: NO_GROUND_TRUTH - type the true text first (ocr truth creates the file).");
      expect(other.lines[0]).toBe("OCR compare rejected: GROUND_TRUTH_MISMATCH");
      expect(broken.lines[0]).toBe("OCR compare rejected: GROUND_TRUTH_INVALID");
    }, "ocr-compare-stop");
  });
});