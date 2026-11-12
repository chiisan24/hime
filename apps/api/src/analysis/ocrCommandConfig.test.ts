import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createCanvas } from "@napi-rs/canvas";
import { sha256Hex, type Result } from "@ehime-vote-navigator/domain";
import { describe, expect, it } from "vitest";

import { withTemporaryTestDirectory } from "../../../../tests/harness/temporary-directory.js";
import type { OcrSettings } from "../ocr/ocrConfig.js";
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
const DEFAULT_DIR = ["data", "real", "ocr", SHA, "trial"];
const BOX_DIR = ["data", "real", "ocr", SHA, "trial-per-box-200dpi"];
const REGIONS = ["--region", "A=1:0.1,0.1,0.6,0.5", "--region", "B=2:0.2,0.2,0.7,0.6"];
const TRIAL = ["ocr", "trial", "--file", "bulletin.pdf", ...REGIONS];
const COMPARE = ["ocr", "compare", "--file", "bulletin.pdf"];
const TEXT_A = `ALPHA-${MARKER}\n縦書きの例`;

type TrialJson = {
  regions: Array<{ groundTruth: string; id: string }>;
  configKey?: string;
  dpi?: number;
  strategy?: string;
} & Record<string, unknown>;

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

function fakeRasterizer() {
  const requests: RasterizeRequest[] = [];
  const rasterizer: PageRasterizer = {
    rasterize: async (_bytes, wanted) => {
      requests.push(...wanted);
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

function fakeSession(text = TEXT_A) {
  const seen: OcrSettings[] = [];
  const createOcrSession = async (settings: OcrSettings): Promise<Result<OcrSession, OcrError>> => {
    seen.push(settings);
    return {
      ok: true,
      value: {
        engine: {
          id: `fake-ocr@1+${settings.strategy}`,
          recognize: async (image) => {
            const spanX = image.region.x1 - image.region.x0;
            const spanY = image.region.y1 - image.region.y0;
            const [first = "", second = ""] = text.split("\n");
            const line = (content: string, vertical: boolean, y0: number, y1: number): OcrLine => ({
              box: {
                x0: image.region.x0 + (vertical ? 0.8 : 0.1) * spanX,
                x1: image.region.x0 + (vertical ? 0.9 : 0.9) * spanX,
                y0: image.region.y0 + y0 * spanY,
                y1: image.region.y0 + y1 * spanY,
              },
              confidence: 0.9,
              orientation: vertical ? "vertical" : "horizontal",
              text: content,
            });
            return { ok: true, value: [line(first, false, 0.1, 0.2), line(second, true, 0.3, 0.9)] };
          },
        },
        networkAttempts: () => 0,
      },
    };
  };
  return { createOcrSession, seen };
}

async function readJson(root: string, directory: string[], name: string): Promise<TrialJson> {
  return JSON.parse(await readFile(join(root, ...directory, name), "utf8")) as TrialJson;
}

async function run(root: string, argv: string[], extra: Record<string, unknown> = {}) {
  const { io, lines } = createIo();
  const rasterizer = fakeRasterizer();
  const session = fakeSession();
  const code = await runAnalysisCli(argv, {
    workspaceRoot: root,
    io,
    rasterizer: rasterizer.rasterizer,
    createOcrSession: session.createOcrSession,
    ...extra,
  });
  return { code, lines, requests: rasterizer.requests, seen: session.seen };
}

describe("ocr trial settings", () => {
  it("keeps the results of other settings in their own directory and leaves the default results alone", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await run(root, TRIAL);
      const before = await readFile(join(root, ...DEFAULT_DIR, "ocr-results.json"), "utf8");

      const other = await run(root, [...TRIAL, "--strategy", "per-box", "--dpi", "200"]);

      expect(other.code).toBe(0);
      expect(other.seen).toEqual([{ dpi: 200, strategy: "per-box" }]);
      expect(other.requests.map((request) => request.dpi)).toEqual([200, 200]);
      expect(other.lines[0]).toMatch(/engine=fake-ocr@1\+per-box dpi=200 strategy=per-box config=per-box-200dpi regions=2 /u);
      expect(other.lines.at(-1)).toBe(
        "The ground truth is shared with the default settings; ocr compare reads it from the default trial directory.",
      );
      expect(await readJson(root, BOX_DIR, "ocr-results.json")).toMatchObject({ configKey: "per-box-200dpi", dpi: 200, strategy: "per-box" });
      await expect(readFile(join(root, ...BOX_DIR, "ground-truth.json"))).rejects.toThrow();
      expect(await readFile(join(root, ...DEFAULT_DIR, "ocr-results.json"), "utf8")).toBe(before);
      expect(await readJson(root, DEFAULT_DIR, "ocr-results.json")).toMatchObject({ configKey: "per-line-300dpi", dpi: 300, strategy: "per-line" });
    }, "ocr-config-dirs");
  });

  it.each([
    ["an unknown strategy", [...TRIAL, "--strategy", "cross-line"]],
    ["a repeated strategy", [...TRIAL, "--strategy", "per-box", "--strategy", "per-line"]],
    ["compare with an unknown strategy", [...COMPARE, "--strategy", "nope"]],
    ["compare with a bad dpi", [...COMPARE, "--dpi", "x"]],
  ])("prints the usage for %s", async (_label, argv) => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);

      const result = await run(root, argv);

      expect(result.code).toBe(1);
      expect(result.lines[0]).toBe("Usage: npm run analysis -- <command>");
      expect(result.requests).toEqual([]);
    }, "ocr-config-usage");
  });
});

describe("ocr truth and compare", () => {
  async function typeJson(root: string, texts: Record<string, string>): Promise<void> {
    const truth = await readJson(root, DEFAULT_DIR, "ground-truth.json");
    for (const region of truth.regions) {
      region.groundTruth = texts[region.id] ?? "";
    }
    await writeFile(join(root, ...DEFAULT_DIR, "ground-truth.json"), JSON.stringify(truth));
  }

  it("creates a text template that holds only instructions, and never overwrites it", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await run(root, TRIAL);

      const first = await run(root, ["ocr", "truth", "--file", "bulletin.pdf", "--region", "B"]);
      const file = join(root, ...DEFAULT_DIR, "ground-truth-B.txt");
      const template = await readFile(file, "utf8");
      await writeFile(file, `${template}typed by a person\n`);
      const second = await run(root, ["ocr", "truth", "--file", "bulletin.pdf", "--region", "B"]);

      expect(first.code).toBe(0);
      expect(first.lines[0]).toBe("OCR truth: region=B page=2 image=region-B.png size=120x60 file=ground-truth-B.txt created");
      expect(template.split("\n").every((line) => line === "" || line.startsWith("#"))).toBe(true);
      expect(template).not.toContain(MARKER);
      expect(template).not.toContain("縦書きの例");
      expect(second.lines[0]).toMatch(/already existed and was left unchanged$/u);
      expect(await readFile(file, "utf8")).toBe(`${template}typed by a person\n`);
      expect(first.lines.join("\n")).not.toContain(root);
    }, "ocr-truth");
  });

  it("rejects an unknown region, missing results and a bad region id", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const missing = await run(root, ["ocr", "truth", "--file", "bulletin.pdf", "--region", "B"]);
      await run(root, TRIAL);
      const unknown = await run(root, ["ocr", "truth", "--file", "bulletin.pdf", "--region", "Z"]);
      const bad = await run(root, ["ocr", "truth", "--file", "bulletin.pdf", "--region", "../B"]);

      expect(missing.lines[0]).toBe("OCR truth rejected: RESULTS_NOT_FOUND");
      expect(unknown.lines[0]).toBe("OCR truth rejected: REGION_NOT_FOUND");
      expect(bad.lines[0]).toBe("Usage: npm run analysis -- <command>");
    }, "ocr-truth-errors");
  });

  it("scores a region typed in the text file, ignoring # lines, and prefers it to the JSON entry", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await run(root, TRIAL);
      await typeJson(root, { A: "completely different text" });
      await writeFile(join(root, ...DEFAULT_DIR, "ground-truth-A.txt"), `# note\n${TEXT_A}\n# end\n`);

      const result = await run(root, COMPARE);

      expect(result.code).toBe(0);
      expect(result.lines[0]).toMatch(/^Region A: .* f1=1.000 .* result=PASS$/u);
      expect(result.lines[1]).toBe("OCR compare: regionsScored=1 passed=1 failed=0 minF1=0.95 verdict=ACCURATE_ENOUGH config=per-line-300dpi engine=fake-ocr@1+per-line");
      expect(result.lines.join("\n")).not.toContain(MARKER);
    }, "ocr-compare-txt");
  });

  it("falls back to the JSON entry when the text file holds only # lines", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await run(root, TRIAL);
      await run(root, ["ocr", "truth", "--file", "bulletin.pdf", "--region", "A"]);
      await typeJson(root, { A: TEXT_A });

      const result = await run(root, COMPARE);

      expect(result.code).toBe(0);
      expect(result.lines[0]).toMatch(/^Region A: .* result=PASS$/u);
    }, "ocr-compare-fallback");
  });

  it("stops with NO_GROUND_TRUTH when nothing was typed", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await run(root, TRIAL);
      await run(root, ["ocr", "truth", "--file", "bulletin.pdf", "--region", "B"]);

      const result = await run(root, COMPARE);

      expect(result.code).toBe(1);
      expect(result.lines[0]).toBe("OCR compare: NO_GROUND_TRUTH - type the true text first (ocr truth creates the file).");
    }, "ocr-compare-empty");
  });

  it("compares the results of another setting with the same typed text, separately from the default", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await run(root, TRIAL);
      await runAnalysisCli([...TRIAL, "--strategy", "per-box", "--dpi", "200"], {
        workspaceRoot: root,
        io: createIo().io,
        rasterizer: fakeRasterizer().rasterizer,
        createOcrSession: fakeSession(`ALPHA-${MARKER}\n全く別の文字列です`).createOcrSession,
      });
      await writeFile(join(root, ...DEFAULT_DIR, "ground-truth-A.txt"), TEXT_A);

      const base300 = await run(root, COMPARE);
      const perBox = await run(root, [...COMPARE, "--strategy", "per-box", "--dpi", "200"]);
      const wrongSetting = await run(root, [...COMPARE, "--dpi", "150"]);

      expect(base300.code).toBe(0);
      expect(base300.lines.at(-2)).toMatch(/verdict=ACCURATE_ENOUGH config=per-line-300dpi /u);
      expect(perBox.code).toBe(1);
      expect(perBox.lines.at(-2)).toMatch(/verdict=NOT_ACCURATE_ENOUGH config=per-box-200dpi engine=fake-ocr@1\+per-box$/u);
      expect(await readJson(root, BOX_DIR, "comparison.json")).toMatchObject({ configKey: "per-box-200dpi", verdict: "NOT_ACCURATE_ENOUGH" });
      expect(await readJson(root, DEFAULT_DIR, "comparison.json")).toMatchObject({ configKey: "per-line-300dpi", verdict: "ACCURATE_ENOUGH" });
      expect(wrongSetting.lines[0]).toBe("OCR compare rejected: RESULTS_NOT_FOUND");
    }, "ocr-compare-configs");
  });

  it("refuses results whose recorded settings differ from the directory", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await run(root, TRIAL);
      await run(root, [...TRIAL, "--strategy", "per-box", "--dpi", "200"]);
      await writeFile(join(root, ...DEFAULT_DIR, "ground-truth-A.txt"), TEXT_A);
      const results = await readJson(root, BOX_DIR, "ocr-results.json");
      await writeFile(join(root, ...BOX_DIR, "ocr-results.json"), JSON.stringify({ ...results, strategy: "per-line" }));

      const result = await run(root, [...COMPARE, "--strategy", "per-box", "--dpi", "200"]);

      expect(result.code).toBe(1);
      expect(result.lines[0]).toBe("OCR compare rejected: GROUND_TRUTH_MISMATCH");
    }, "ocr-compare-recorded");
  });

  it("scores results saved before the strategy was recorded as per-line", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await run(root, TRIAL);
      await writeFile(join(root, ...DEFAULT_DIR, "ground-truth-A.txt"), TEXT_A);
      const old = await readJson(root, DEFAULT_DIR, "ocr-results.json");
      delete old.strategy;
      delete old.configKey;
      await writeFile(join(root, ...DEFAULT_DIR, "ocr-results.json"), JSON.stringify(old));

      const result = await run(root, COMPARE);

      expect(result.code).toBe(0);
      expect(result.lines[0]).toMatch(/result=PASS$/u);
    }, "ocr-compare-old-results");
  });
});

describe("OCR_TRACE", () => {
  it("traces every step with times and memory, and never writes page text or paths", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const trace: string[] = [];

      const result = await run(root, TRIAL, { ocrTrace: { write: (line: string) => { trace.push(line); } } });

      expect(result.code).toBe(0);
      const text = trace.join("\n");
      for (const stage of ["pdf-read", "render", "model-load", "recognize", "save", "release"]) {
        expect(text).toMatch(new RegExp(`OCR_TRACE \\+\\d+\\.\\d{3}s ${stage} start rssMb=\\d+`, "u"));
        expect(text).toMatch(new RegExp(`OCR_TRACE \\+\\d+\\.\\d{3}s ${stage} end rssMb=\\d+.* ms=\\d+`, "u"));
      }
      expect(text).toMatch(/crop region rssMb=\d+ height=60 pixels=7200 region=A width=120/u);
      expect(text).toMatch(/recognize start rssMb=\d+ region=B/u);
      expect(text).toMatch(/run exit-check rssMb=\d+ resources=\d+/u);
      expect(text).not.toContain(MARKER);
      expect(text).not.toContain("縦書き");
      expect(text).not.toContain(root);
      expect(result.lines.join("\n")).not.toContain("OCR_TRACE");
    }, "ocr-trace");
  });

  it("writes no trace line when tracing is off", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);

      const result = await run(root, TRIAL);

      expect(result.code).toBe(0);
      expect(result.lines.some((line) => line.includes("OCR_TRACE"))).toBe(false);
    }, "ocr-trace-off");
  });
});