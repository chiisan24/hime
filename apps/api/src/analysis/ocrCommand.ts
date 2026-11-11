import { access, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { sha256Hex, type Result } from "@ehime-vote-navigator/domain";
import { z } from "zod";

import { createStoragePathConfig } from "../config/paths.js";
import { scoreText } from "../ocr/cer.js";
import {
  DEFAULT_OCR_SETTINGS,
  RECOGNITION_STRATEGIES,
  isDefaultSettings,
  isRecognitionStrategy,
  ocrConfigKey,
  trialDirectoryName,
  type OcrSettings,
  type RecognitionStrategy,
} from "../ocr/ocrConfig.js";
import type {
  NormalizedBox,
  OcrError,
  OcrLine,
  OcrSession,
  PageImage,
  PageRasterizer,
} from "../ocr/ocrTypes.js";
import { orderLines } from "../ocr/readingOrder.js";
import { NO_TRACE, type Tracer } from "../ocr/trace.js";
import type { AtomicFileOperationOverrides } from "../store/atomicFiles.js";
import { atomicReplaceFile } from "../store/atomicReplaceFile.js";
import { isRawPdfFileName } from "./inspectCommand.js";

/** Lines below this confidence are marked for a reviewer. */
export const LOW_CONFIDENCE = 0.8;
/** Proposed pass mark for the order-free character F1 of every checked region. */
export const DEFAULT_MIN_F1 = 0.95;
/** A trial is a sample, not a document run: few regions, each at most half a page. */
export const MAX_TRIAL_REGIONS = 5;
export const MAX_REGION_AREA = 0.5;
/** Rounding a region to whole pixels moves its edges by less than this. */
const BOX_TOLERANCE = 0.002;
const REGION_ID = /^[A-Za-z0-9-]{1,16}$/u;

export type TrialRegion = Readonly<{ box: NormalizedBox; id: string; page: number }>;
export type TrialArgs = Readonly<{
  dpi?: number;
  file: string;
  regions: readonly TrialRegion[];
  strategy?: RecognitionStrategy;
}>;
export type CompareArgs = Readonly<{ dpi: number; file: string; minF1: number; strategy: RecognitionStrategy }>;
export type TruthArgs = Readonly<{ file: string; regionId: string }>;

export type OcrCommandDependencies = Readonly<{
  createSession: (settings: OcrSettings, trace: Tracer) => Promise<Result<OcrSession, OcrError>>;
  io: Readonly<{ write: (line: string) => void }>;
  /** Test seam for the local file writes; the real filesystem is the default. */
  operations?: AtomicFileOperationOverrides;
  rasterizer: PageRasterizer;
  /** Diagnostics for `OCR_TRACE=1`; nothing is traced by default. */
  trace?: Tracer;
  workspaceRoot: string;
}>;

const BoxSchema = z.object({ x0: z.number(), x1: z.number(), y0: z.number(), y1: z.number() }).strict();
const ResultsSchema = z
  .object({
    configKey: z.string().optional(),
    dpi: z.number(),
    engine: z.string(),
    file: z.string(),
    regions: z.array(
      z
        .object({
          box: BoxSchema,
          height: z.number().int().positive(),
          id: z.string(),
          image: z.string(),
          lines: z.array(
            z
              .object({
                box: BoxSchema,
                confidence: z.number(),
                n: z.number().int().positive(),
                orientation: z.enum(["horizontal", "vertical"]),
                text: z.string(),
              })
              .strict(),
          ),
          overlay: z.string(),
          page: z.number().int().positive(),
          width: z.number().int().positive(),
        })
        .strict(),
    ),
    schemaVersion: z.literal(1),
    sha256: z.string(),
    // Results saved before the strategy was recorded were made with per-line.
    strategy: z.enum(RECOGNITION_STRATEGIES).default("per-line"),
    textLayerUsed: z.literal(false),
  })
  .strict();
const GroundTruthSchema = z
  .object({
    file: z.string(),
    instructions: z.string(),
    regions: z.array(
      z
        .object({
          box: BoxSchema,
          groundTruth: z.string(),
          id: z.string(),
          image: z.string(),
          page: z.number().int().positive(),
        })
        .strict(),
    ),
    schemaVersion: z.literal(1),
    sha256: z.string(),
  })
  .strict();

type Results = z.infer<typeof ResultsSchema>;

export function parseRegionSpec(spec: string): TrialRegion | undefined {
  const match = /^([A-Za-z0-9-]{1,16})=([1-9][0-9]{0,2}):([0-9.]+),([0-9.]+),([0-9.]+),([0-9.]+)$/u.exec(spec);
  if (match === null) {
    return undefined;
  }
  const [x0, y0, x1, y1] = [match[3], match[4], match[5], match[6]].map(Number);
  if (x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined) {
    return undefined;
  }
  const inRange = [x0, y0, x1, y1].every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  if (!inRange || x0 >= x1 || y0 >= y1 || (x1 - x0) * (y1 - y0) > MAX_REGION_AREA) {
    return undefined;
  }
  return { box: { x0, x1, y0, y1 }, id: match[1] ?? "", page: Number(match[2]) };
}

export function parseTrialArgs(args: readonly string[]): TrialArgs | undefined {
  let file: string | undefined;
  let dpi: number | undefined;
  let strategy: RecognitionStrategy | undefined;
  const regions: TrialRegion[] = [];
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return undefined;
    }
    if (flag === "--file" && file === undefined) {
      file = value;
    } else if (flag === "--dpi" && dpi === undefined && /^[0-9]{2,3}$/u.test(value)) {
      dpi = Number(value);
    } else if (flag === "--strategy" && strategy === undefined && isRecognitionStrategy(value)) {
      strategy = value;
    } else if (flag === "--region") {
      const region = parseRegionSpec(value);
      if (region === undefined || regions.length >= MAX_TRIAL_REGIONS || regions.some((entry) => entry.id === region.id)) {
        return undefined;
      }
      regions.push(region);
    } else {
      return undefined;
    }
  }
  if (file === undefined || regions.length === 0) {
    return undefined;
  }
  return {
    ...(dpi === undefined ? {} : { dpi }),
    file,
    regions,
    ...(strategy === undefined ? {} : { strategy }),
  };
}

export function parseCompareArgs(args: readonly string[]): CompareArgs | undefined {
  let file: string | undefined;
  let minF1: number | undefined;
  let dpi: number | undefined;
  let strategy: RecognitionStrategy | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return undefined;
    }
    if (flag === "--file" && file === undefined) {
      file = value;
    } else if (flag === "--min-f1" && minF1 === undefined && /^(?:0(?:\.[0-9]+)?|1(?:\.0+)?)$/u.test(value)) {
      minF1 = Number(value);
    } else if (flag === "--dpi" && dpi === undefined && /^[0-9]{2,3}$/u.test(value)) {
      dpi = Number(value);
    } else if (flag === "--strategy" && strategy === undefined && isRecognitionStrategy(value)) {
      strategy = value;
    } else {
      return undefined;
    }
  }
  return file === undefined
    ? undefined
    : {
        dpi: dpi ?? DEFAULT_OCR_SETTINGS.dpi,
        file,
        minF1: minF1 ?? DEFAULT_MIN_F1,
        strategy: strategy ?? DEFAULT_OCR_SETTINGS.strategy,
      };
}

export function parseTruthArgs(args: readonly string[]): TruthArgs | undefined {
  let file: string | undefined;
  let regionId: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return undefined;
    }
    if (flag === "--file" && file === undefined) {
      file = value;
    } else if (flag === "--region" && regionId === undefined && REGION_ID.test(value)) {
      regionId = value;
    } else {
      return undefined;
    }
  }
  return file === undefined || regionId === undefined ? undefined : { file, regionId };
}

function reject(io: OcrCommandDependencies["io"], command: string, code: string, message: string): number {
  io.write(`${command} rejected: ${code}`);
  io.write(message);
  return 1;
}

async function readPdf(
  args: Readonly<{ file: string }>,
  deps: OcrCommandDependencies,
): Promise<Result<{ bytes: Uint8Array; sha256: string }, string>> {
  if (!isRawPdfFileName(args.file)) {
    return { ok: false, error: "INVALID_FILE_NAME" };
  }
  try {
    const storage = createStoragePathConfig(deps.workspaceRoot);
    const bytes = new Uint8Array(await readFile(join(storage.realDataRoot, "raw", args.file)));
    return { ok: true, value: { bytes, sha256: sha256Hex(bytes) } };
  } catch {
    return { ok: false, error: "RAW_FILE_UNREADABLE" };
  }
}

function trialDirectory(sha256: string, settings: OcrSettings): string {
  return `ocr/${sha256}/${trialDirectoryName(settings)}`;
}

async function readJsonFile<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S> | undefined> {
  try {
    const parsed = schema.safeParse(JSON.parse(await readFile(path, "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function sameBox(left: NormalizedBox, right: NormalizedBox): boolean {
  return (["x0", "x1", "y0", "y1"] as const).every((key) => Math.abs(left[key] - right[key]) <= BOX_TOLERANCE);
}

async function drawOverlay(png: Uint8Array, rendered: NormalizedBox, lines: readonly OcrLine[]): Promise<Uint8Array> {
  const image = await loadImage(Buffer.from(png));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  context.lineWidth = Math.max(2, Math.round(image.width / 400));
  context.font = `bold ${Math.max(14, Math.round(image.width / 50))}px sans-serif`;

  const spanX = rendered.x1 - rendered.x0;
  const spanY = rendered.y1 - rendered.y0;
  lines.forEach((line, index) => {
    const x = ((line.box.x0 - rendered.x0) / spanX) * image.width;
    const y = ((line.box.y0 - rendered.y0) / spanY) * image.height;
    const width = ((line.box.x1 - line.box.x0) / spanX) * image.width;
    const height = ((line.box.y1 - line.box.y0) / spanY) * image.height;
    const color = line.confidence < LOW_CONFIDENCE ? "#d97706" : line.orientation === "vertical" ? "#c026d3" : "#2563eb";
    context.strokeStyle = color;
    context.fillStyle = color;
    context.strokeRect(x, y, width, height);
    context.fillText(String(index + 1), x, Math.max(y - 3, 14));
  });
  return new Uint8Array(canvas.toBuffer("image/png"));
}

function numberedText(lines: readonly OcrLine[]): string {
  return `${lines
    .map(
      (line, index) =>
        `${String(index + 1).padStart(3, "0")} [${line.orientation === "vertical" ? "V" : "H"} ${line.confidence.toFixed(2)}] ${line.text}`,
    )
    .join("\n")}\n`;
}

const INSTRUCTIONS =
  "各 groundTruth に、image の画像を見て原本どおりの文字を入力してください(改行は \\n、読む順に)。" +
  "長い文章は ground-truth-<領域ID>.txt に書く方が楽です(ocr truth で作れます)。" +
  "空欄の領域は比較されません。OCR の結果は見ずに入力してください。このファイルはGitに入れず、公開しないでください。";

function truthTemplate(regionId: string, page: number, image: string): string {
  return [
    `# 領域 ${regionId}(${page}ページ)の正解文`,
    `# 1. ${image}(または原本PDFの該当ページ)を見て、文字を原本どおりに、この下へ入力してください。`,
    "# 2. 見えた行の順に、1行ずつ書きます。縦書きは右の列から、各列を上から下へ読む順に書きます。",
    "# 3. 漢字・かな・記号・数字は見たまま入力します(空白と全角半角の違いは採点で無視されます)。",
    "#    読めない文字は ■ で書いてください(採点では不一致として数えます)。",
    "# 4. 「#」で始まる行は無視されます。OCR の結果(region-*-ocr.txt)は、入力が終わるまで見ないでください。",
    "# 5. 入力後に ocr compare を実行します。",
    "",
    "",
  ].join("\n");
}

/** The typed text of a region: the .txt file when it has text, otherwise the JSON entry. */
async function typedGroundTruth(
  root: string,
  directory: string,
  entry: Readonly<{ groundTruth: string; id: string }>,
): Promise<string> {
  try {
    const text = await readFile(join(root, ...directory.split("/"), `ground-truth-${entry.id}.txt`), "utf8");
    const typed = text
      .split(/\r?\n/u)
      .filter((line) => !line.startsWith("#"))
      .join("\n")
      .trim();
    if (typed !== "") {
      return typed;
    }
  } catch {
    // There is no text file for this region: use the JSON entry.
  }
  return entry.groundTruth.trim();
}

/**
 * Runs the OCR engine on a few parts of a PDF in `data/real/raw` and saves,
 * below `data/real/ocr/<sha256>/`, each part as an image, the same image with
 * the recognised line boxes drawn on it, the numbered lines, the results as
 * JSON, and (for the default settings) an empty ground-truth template. Results
 * of other settings (strategy, resolution) go to their own directory, so one
 * run never replaces another. The text layer is not used. Page text is never
 * printed; the output holds counts only. An existing ground-truth file is never
 * overwritten.
 */
export async function runOcrTrial(args: TrialArgs, deps: OcrCommandDependencies): Promise<number> {
  const { io } = deps;
  const trace = deps.trace ?? NO_TRACE;
  const command = "OCR trial";
  const settings: OcrSettings = {
    dpi: args.dpi ?? DEFAULT_OCR_SETTINGS.dpi,
    strategy: args.strategy ?? DEFAULT_OCR_SETTINGS.strategy,
  };
  const configKey = ocrConfigKey(settings);

  const pdf = await trace.stage("pdf-read", () => readPdf(args, deps));
  if (!pdf.ok) {
    return reject(io, command, pdf.error, "Give the name of a PDF placed directly in data/real/raw.");
  }

  const renderStarted = Date.now();
  const rendered = await trace.stage(
    "render",
    () =>
      deps.rasterizer.rasterize(
        pdf.value.bytes,
        args.regions.map((region) => ({ dpi: settings.dpi, page: region.page, region: region.box })),
      ),
    { dpi: settings.dpi, regions: args.regions.length },
  );
  if (!rendered.ok) {
    return reject(io, command, rendered.error.code, "The requested parts could not be rendered.");
  }
  const renderMs = Date.now() - renderStarted;
  // A region is cut out while the page is drawn, so the crop is reported from the rendered sizes.
  for (const [index, image] of rendered.value.entries()) {
    trace.event("crop", "region", {
      height: image.height,
      pixels: image.width * image.height,
      region: args.regions[index]?.id ?? "?",
      width: image.width,
    });
  }

  const loadStarted = Date.now();
  const session = await trace.stage("model-load", () => deps.createSession(settings, trace), {
    strategy: settings.strategy,
  });
  const modelLoadMs = Date.now() - loadStarted;
  if (!session.ok) {
    return reject(io, command, session.error.code, "The OCR engine could not be started.");
  }

  try {
    const started = Date.now();
    const parts: Array<{ image: PageImage; lines: OcrLine[]; ms: number; region: TrialRegion }> = [];
    for (const [index, image] of rendered.value.entries()) {
      const region = args.regions[index];
      if (region === undefined) {
        continue;
      }
      const regionStarted = Date.now();
      const recognised = await trace.stage("recognize", () => session.value.engine.recognize(image), {
        region: region.id,
      });
      if (!recognised.ok) {
        return reject(io, command, recognised.error.code, "The text could not be recognised.");
      }
      parts.push({ image, lines: orderLines(recognised.value), ms: Date.now() - regionStarted, region });
    }
    const recognizeMs = Date.now() - started;

    const storage = createStoragePathConfig(deps.workspaceRoot);
    const directory = trialDirectory(pdf.value.sha256, settings);
    const save = async (name: string, bytes: Uint8Array): Promise<void> => {
      await atomicReplaceFile({
        allowedRoot: storage.realDataRoot,
        bytes,
        relativePath: `${directory}/${name}`,
        ...(deps.operations === undefined ? {} : { operations: deps.operations }),
      });
    };

    let groundTruth: "created" | "kept" | "shared";
    try {
      groundTruth = await trace.stage("save", async () => {
        await mkdir(storage.realDataRoot, { recursive: true });
        const results = {
          configKey,
          dpi: settings.dpi,
          engine: session.value.engine.id,
          file: args.file,
          regions: [] as unknown[],
          schemaVersion: 1,
          sha256: pdf.value.sha256,
          strategy: settings.strategy,
          textLayerUsed: false,
        };
        const template = {
          file: args.file,
          instructions: INSTRUCTIONS,
          regions: [] as unknown[],
          schemaVersion: 1,
          sha256: pdf.value.sha256,
        };
        for (const part of parts) {
          const id = part.region.id;
          const image = `region-${id}.png`;
          const overlay = `region-${id}-overlay.png`;
          await save(image, part.image.png);
          await save(overlay, await drawOverlay(part.image.png, part.image.region, part.lines));
          await save(`region-${id}-ocr.txt`, new TextEncoder().encode(numberedText(part.lines)));
          results.regions.push({
            box: part.image.region,
            height: part.image.height,
            id,
            image,
            lines: part.lines.map((line, lineIndex) => ({ ...line, n: lineIndex + 1 })),
            overlay,
            page: part.region.page,
            width: part.image.width,
          });
          template.regions.push({ box: part.image.region, groundTruth: "", id, image, page: part.region.page });
        }
        await save("ocr-results.json", new TextEncoder().encode(`${JSON.stringify(results, null, 2)}\n`));

        if (!isDefaultSettings(settings)) {
          return "shared" as const;
        }
        const exists = await access(join(storage.realDataRoot, ...directory.split("/"), "ground-truth.json")).then(
          () => true,
          () => false,
        );
        if (!exists) {
          await save("ground-truth.json", new TextEncoder().encode(`${JSON.stringify(template, null, 2)}\n`));
        }
        return exists ? ("kept" as const) : ("created" as const);
      });
    } catch {
      return reject(io, command, "TRIAL_WRITE_FAILED", "The trial files could not be written.");
    }

    io.write(
      `OCR trial: file=${args.file} sha256=${pdf.value.sha256} engine=${session.value.engine.id} dpi=${settings.dpi} strategy=${settings.strategy} config=${configKey} regions=${parts.length} textLayerUsed=false networkAttempts=${session.value.networkAttempts?.() ?? 0} renderMs=${renderMs} modelLoadMs=${modelLoadMs} recognizeMs=${recognizeMs} peakRssMb=${Math.round(process.resourceUsage().maxRSS / 1024)}`,
    );
    for (const part of parts) {
      const confidences = part.lines.map((line) => line.confidence);
      const mean = confidences.length === 0 ? 0 : confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
      io.write(
        `Region ${part.region.id}: page=${part.region.page} box=${part.image.region.x0.toFixed(3)},${part.image.region.y0.toFixed(3)},${part.image.region.x1.toFixed(3)},${part.image.region.y1.toFixed(3)} image=${part.image.width}x${part.image.height} lines=${part.lines.length} horizontal=${part.lines.filter((line) => line.orientation === "horizontal").length} vertical=${part.lines.filter((line) => line.orientation === "vertical").length} meanConfidence=${mean.toFixed(2)} minConfidence=${(confidences.length === 0 ? 0 : Math.min(...confidences)).toFixed(2)} lowConfidence=${confidences.filter((value) => value < LOW_CONFIDENCE).length} recognizeMs=${part.ms}`,
      );
    }
    io.write(`Files: data/real/${directory}/ (local only, not tracked by Git)`);
    io.write(
      groundTruth === "created"
        ? "ground-truth.json is empty: a person must type the true text of each region before ocr compare."
        : groundTruth === "kept"
          ? "ground-truth.json already exists and was left unchanged."
          : "The ground truth is shared with the default settings; ocr compare reads it from the default trial directory.",
    );
    return 0;
  } finally {
    await trace.stage("release", async () => {
      await session.value.close?.();
    });
  }
}

/**
 * Creates the plain-text file in which a person types the true text of one
 * region of an existing trial. It uses the results of the default settings,
 * makes no OCR and no rendering, and never overwrites a file that exists. The
 * output holds counts and file names only.
 */
export async function runOcrTruth(args: TruthArgs, deps: OcrCommandDependencies): Promise<number> {
  const { io } = deps;
  const command = "OCR truth";
  const pdf = await readPdf(args, deps);
  if (!pdf.ok) {
    return reject(io, command, pdf.error, "Give the name of a PDF placed directly in data/real/raw.");
  }

  const storage = createStoragePathConfig(deps.workspaceRoot);
  const directory = trialDirectory(pdf.value.sha256, DEFAULT_OCR_SETTINGS);
  const results = await readJsonFile(
    join(storage.realDataRoot, ...directory.split("/"), "ocr-results.json"),
    ResultsSchema,
  );
  if (results === undefined) {
    return reject(io, command, "RESULTS_NOT_FOUND", "Run ocr trial first.");
  }
  const region = results.regions.find((candidate) => candidate.id === args.regionId);
  if (region === undefined) {
    return reject(io, command, "REGION_NOT_FOUND", "That region is not in the saved trial.");
  }

  const name = `ground-truth-${region.id}.txt`;
  const exists = await access(join(storage.realDataRoot, ...directory.split("/"), name)).then(
    () => true,
    () => false,
  );
  try {
    if (!exists) {
      await mkdir(storage.realDataRoot, { recursive: true });
      await atomicReplaceFile({
        allowedRoot: storage.realDataRoot,
        bytes: new TextEncoder().encode(truthTemplate(region.id, region.page, region.image)),
        relativePath: `${directory}/${name}`,
        ...(deps.operations === undefined ? {} : { operations: deps.operations }),
      });
    }
  } catch {
    return reject(io, command, "TRUTH_WRITE_FAILED", "The template could not be written.");
  }

  io.write(
    `OCR truth: region=${region.id} page=${region.page} image=${region.image} size=${region.width}x${region.height} file=${name} ${exists ? "already existed and was left unchanged" : "created"}`,
  );
  io.write(`Folder: data/real/${directory}/ (local only, not tracked by Git)`);
  io.write("Type the text of the image into that file, below the # lines, without looking at the OCR output. Then run ocr compare.");
  return 0;
}

/**
 * Compares the OCR results of a trial with the text a person typed (a
 * ground-truth-<region>.txt file, or the groundTruth field of ground-truth.json).
 * The ground truth belongs to the default trial directory and is checked
 * against the results of the chosen settings. Only regions with a typed text
 * are scored. A region passes when its order-free character F1 reaches the
 * minimum. Prints numbers only; any failure means the full document must not
 * be analysed.
 */
export async function runOcrCompare(args: CompareArgs, deps: OcrCommandDependencies): Promise<number> {
  const { io } = deps;
  const command = "OCR compare";
  const pdf = await readPdf(args, deps);
  if (!pdf.ok) {
    return reject(io, command, pdf.error, "Give the name of a PDF placed directly in data/real/raw.");
  }

  const storage = createStoragePathConfig(deps.workspaceRoot);
  const settings: OcrSettings = { dpi: args.dpi, strategy: args.strategy };
  const configKey = ocrConfigKey(settings);
  const resultsDirectory = trialDirectory(pdf.value.sha256, settings);
  const truthDirectory = trialDirectory(pdf.value.sha256, DEFAULT_OCR_SETTINGS);

  const results: Results | undefined = await readJsonFile(
    join(storage.realDataRoot, ...resultsDirectory.split("/"), "ocr-results.json"),
    ResultsSchema,
  );
  if (results === undefined) {
    return reject(io, command, "RESULTS_NOT_FOUND", "Run ocr trial first (with the same --dpi and --strategy).");
  }
  const truth = await readJsonFile(
    join(storage.realDataRoot, ...truthDirectory.split("/"), "ground-truth.json"),
    GroundTruthSchema,
  );
  if (truth === undefined) {
    return reject(io, command, "GROUND_TRUTH_INVALID", "ground-truth.json is missing or not valid.");
  }
  if (
    truth.sha256 !== pdf.value.sha256 ||
    results.sha256 !== pdf.value.sha256 ||
    truth.file !== args.file ||
    results.dpi !== settings.dpi ||
    results.strategy !== settings.strategy
  ) {
    return reject(io, command, "GROUND_TRUTH_MISMATCH", "The files belong to a different PDF or to other OCR settings.");
  }

  const rows: Array<Record<string, unknown>> = [];
  let failed = 0;
  for (const entry of truth.regions) {
    const typed = await typedGroundTruth(storage.realDataRoot, truthDirectory, entry);
    if (typed === "") {
      continue;
    }
    const region = results.regions.find((candidate) => candidate.id === entry.id);
    if (region === undefined || region.page !== entry.page || !sameBox(region.box, entry.box)) {
      return reject(io, command, "GROUND_TRUTH_MISMATCH", "A ground-truth region does not match an OCR result.");
    }
    const recognised = [...region.lines].sort((left, right) => left.n - right.n).map((line) => line.text).join("\n");
    const score = scoreText(typed, recognised);
    const passed = score.f1 >= args.minF1;
    const orderSuspect = score.cer - (1 - score.f1) > 0.1;
    if (!passed) {
      failed += 1;
    }
    rows.push({ id: entry.id, ...score, orderSuspect, passed });
    io.write(
      `Region ${entry.id}: referenceChars=${score.referenceChars} ocrChars=${score.hypothesisChars} cer=${score.cer.toFixed(3)} f1=${score.f1.toFixed(3)} recall=${score.recall.toFixed(3)} precision=${score.precision.toFixed(3)} result=${passed ? "PASS" : "FAIL"}${orderSuspect ? " READING_ORDER_SUSPECT" : ""}`,
    );
  }

  if (rows.length === 0) {
    io.write("OCR compare: NO_GROUND_TRUTH - type the true text first (ocr truth creates the file).");
    return 1;
  }

  const verdict = failed === 0 ? "ACCURATE_ENOUGH" : "NOT_ACCURATE_ENOUGH";
  try {
    await atomicReplaceFile({
      allowedRoot: storage.realDataRoot,
      bytes: new TextEncoder().encode(
        `${JSON.stringify({ configKey, engine: results.engine, minF1: args.minF1, regions: rows, schemaVersion: 1, verdict }, null, 2)}\n`,
      ),
      relativePath: `${resultsDirectory}/comparison.json`,
      ...(deps.operations === undefined ? {} : { operations: deps.operations }),
    });
  } catch {
    return reject(io, command, "COMPARISON_WRITE_FAILED", "comparison.json could not be written.");
  }
  io.write(`OCR compare: regionsScored=${rows.length} passed=${rows.length - failed} failed=${failed} minF1=${args.minF1} verdict=${verdict} config=${configKey} engine=${results.engine}`);
  io.write(
    failed === 0
      ? "The sample is accurate enough. Ask the owner before any full-document analysis."
      : "Full-document analysis must not start: the OCR is not accurate enough on this sample.",
  );
  return failed === 0 ? 0 : 1;
}

/** Runs `ocr trial`, `ocr truth` or `ocr compare`. Returns undefined for a usage error. */
export async function runOcrCommand(
  argv: readonly string[],
  deps: OcrCommandDependencies,
): Promise<number | undefined> {
  const [action, ...rest] = argv;
  if (action === "trial") {
    const args = parseTrialArgs(rest);
    return args === undefined ? undefined : runOcrTrial(args, deps);
  }
  if (action === "truth") {
    const args = parseTruthArgs(rest);
    return args === undefined ? undefined : runOcrTruth(args, deps);
  }
  if (action === "compare") {
    const args = parseCompareArgs(rest);
    return args === undefined ? undefined : runOcrCompare(args, deps);
  }
  return undefined;
}