import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { sha256Hex, type Result } from "@ehime-vote-navigator/domain";

import { characterDictionaryFromYaml } from "./modelDictionary.js";
import {
  OCR_RUNTIME_VERSIONS,
  PP_OCRV5_SERVER,
  type OcrModelSet,
  type PinnedModelFile,
} from "./modelManifest.js";
import { DEFAULT_OCR_SETTINGS, type RecognitionStrategy } from "./ocrConfig.js";
import type { OcrError, OcrLine, OcrSession, PageImage } from "./ocrTypes.js";
import { NO_TRACE, type Tracer } from "./trace.js";

/** The small part of ppu-paddle-ocr that the adapter relies on. */
export type PaddleItem = Readonly<{
  box: Readonly<{ height: number; width: number; x: number; y: number }>;
  confidence: number;
  text: string;
}>;
type InstrumentedSession = { run: (...args: unknown[]) => Promise<unknown> };
export type PaddleService = Readonly<{
  /** The inference sessions; wrapped only while tracing, to time detection and recognition. */
  detectionSession?: InstrumentedSession | null;
  destroy: () => Promise<unknown>;
  initialize: () => Promise<unknown>;
  recognitionSession?: InstrumentedSession | null;
  recognize: (
    image: ArrayBuffer,
    options: Record<string, unknown>,
  ) => Promise<{ results?: readonly PaddleItem[] }>;
}>;
export type PaddleServiceFactory = (
  options: Record<string, unknown>,
) => PaddleService | Promise<PaddleService>;

export type PaddleEngineOptions = Readonly<{
  /** Test seam; ppu-paddle-ocr is loaded by default. */
  createService?: PaddleServiceFactory;
  /**
   * Lines below this recognition confidence are dropped by the engine. The
   * default is low on purpose, so a reviewer can see weak lines; the trial
   * flags every line below 0.8.
   */
  minimumConfidence?: number;
  /** Absolute path of the directory that holds the model directories. */
  modelRoot: string;
  modelSet?: OcrModelSet;
  /** How detected boxes are recognised; part of the engine id. */
  strategy?: RecognitionStrategy;
  trace?: Tracer;
}>;

export const DEFAULT_MINIMUM_CONFIDENCE = 0.3;
/** A box at least this much taller than wide, holding two characters or more, is vertical text. */
const VERTICAL_ASPECT_RATIO = 1.5;
const CJK = "\\u3000-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef";
const CJK_GAP = new RegExp(`(?<=[${CJK}])\\s+(?=[${CJK}])`, "gu");

const defaultFactory: PaddleServiceFactory = async (options) => {
  const { PaddleOcrService } = await import("ppu-paddle-ocr");
  return new PaddleOcrService(options as never) as unknown as PaddleService;
};

function failure(code: OcrError["code"]): Result<never, OcrError> {
  return { ok: false, error: Object.freeze({ code }) };
}

async function readPinned(root: string, file: PinnedModelFile): Promise<Uint8Array | undefined> {
  try {
    const bytes = new Uint8Array(await readFile(join(root, file.directory, file.file)));
    return bytes.byteLength === file.bytes && sha256Hex(bytes) === file.sha256 ? bytes : undefined;
  } catch {
    return undefined;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function toLine(item: PaddleItem, image: PageImage): OcrLine {
  const spanX = image.region.x1 - image.region.x0;
  const spanY = image.region.y1 - image.region.y0;
  const text = item.text.replace(CJK_GAP, "");
  const vertical =
    item.box.height >= VERTICAL_ASPECT_RATIO * item.box.width &&
    [...text.replace(/\s+/gu, "")].length >= 2;

  return {
    box: {
      x0: clamp(image.region.x0 + (item.box.x / image.width) * spanX),
      x1: clamp(image.region.x0 + ((item.box.x + item.box.width) / image.width) * spanX),
      y0: clamp(image.region.y0 + (item.box.y / image.height) * spanY),
      y1: clamp(image.region.y0 + ((item.box.y + item.box.height) / image.height) * spanY),
    },
    confidence: clamp(item.confidence),
    orientation: vertical ? "vertical" : "horizontal",
    text,
  };
}

type RunCounter = { ms: number; runs: number };

/** Times every inference call of a session; the session keeps working as before. */
function instrument(session: InstrumentedSession | null | undefined, counter: RunCounter): void {
  if (session === null || session === undefined) {
    return;
  }
  const original = session.run.bind(session);
  session.run = async (...args) => {
    const started = performance.now();
    try {
      return await original(...args);
    } finally {
      counter.runs += 1;
      counter.ms += performance.now() - started;
    }
  };
}

/**
 * Starts a PaddleOCR engine (PP-OCRv5 through ppu-paddle-ocr and onnxruntime-node)
 * from model files that were downloaded beforehand. Every model file is read
 * from disk and checked against its pinned SHA-256 first, and the engine is
 * given the verified bytes, never a path or an address. Network access is
 * blocked while it runs, and attempts are counted. The character dictionary is
 * taken from the verified `inference.yml`. Recognised text keeps its characters
 * as they are, except that spaces between two Japanese characters are removed.
 * The recognition strategy is part of the engine id, so results of different
 * strategies are never taken for each other. With a tracer, the time spent in
 * detection and recognition inference is reported (counts and milliseconds only).
 */
export async function createPaddleOcrEngine(
  options: PaddleEngineOptions,
): Promise<Result<OcrSession, OcrError>> {
  const set = options.modelSet ?? PP_OCRV5_SERVER;
  const minimumConfidence = options.minimumConfidence ?? DEFAULT_MINIMUM_CONFIDENCE;
  const strategy = options.strategy ?? DEFAULT_OCR_SETTINGS.strategy;
  const trace = options.trace ?? NO_TRACE;

  const verifyStarted = performance.now();
  const detection = await readPinned(options.modelRoot, set.detection);
  const recognition = await readPinned(options.modelRoot, set.recognition);
  const config = await readPinned(options.modelRoot, set.recognitionConfig);
  if (detection === undefined || recognition === undefined || config === undefined) {
    return failure("OCR_MODEL_INVALID");
  }
  const dictionary = characterDictionaryFromYaml(new TextDecoder("utf-8").decode(config));
  if (dictionary === undefined || dictionary.length !== set.dictionaryEntries) {
    return failure("OCR_MODEL_INVALID");
  }
  trace.event("model-load", "verified", { ms: Math.round(performance.now() - verifyStarted) });

  let networkAttempts = 0;
  async function withoutNetwork<T>(operation: () => Promise<T>): Promise<T> {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      networkAttempts += 1;
      return Promise.reject(new Error("Network access is disabled during OCR"));
    }) as typeof fetch;
    try {
      return await operation();
    } finally {
      globalThis.fetch = original;
    }
  }

  const detectionRuns: RunCounter = { ms: 0, runs: 0 };
  const recognitionRuns: RunCounter = { ms: 0, runs: 0 };
  let service: PaddleService;
  try {
    const initializeStarted = performance.now();
    service = await (options.createService ?? defaultFactory)({
      model: {
        charactersDictionary: toArrayBuffer(new TextEncoder().encode(dictionary.join("\n"))),
        detection: toArrayBuffer(detection),
        recognition: toArrayBuffer(recognition),
      },
      recognition: { minimumConfidence },
      session: { executionProviders: ["cpu"] },
    });
    await withoutNetwork(() => service.initialize());
    if (trace.enabled) {
      instrument(service.detectionSession, detectionRuns);
      instrument(service.recognitionSession, recognitionRuns);
    }
    trace.event("model-load", "initialized", { ms: Math.round(performance.now() - initializeStarted) });
  } catch {
    return failure("OCR_ENGINE_UNAVAILABLE");
  }

  const id =
    `ppu-paddle-ocr@${OCR_RUNTIME_VERSIONS.ppuPaddleOcr}+onnxruntime-node@${OCR_RUNTIME_VERSIONS.onnxruntimeNode}` +
    `+${set.id}(det:${set.detection.sha256.slice(0, 8)},rec:${set.recognition.sha256.slice(0, 8)})+${strategy}`;

  return {
    ok: true,
    value: {
      close: async () => {
        try {
          await service.destroy();
        } catch {
          // Releasing the sessions is best effort; nothing is left to report.
        }
      },
      engine: {
        id,
        async recognize(image) {
          detectionRuns.ms = 0;
          detectionRuns.runs = 0;
          recognitionRuns.ms = 0;
          recognitionRuns.runs = 0;
          try {
            const result = await withoutNetwork(() =>
              service.recognize(toArrayBuffer(image.png), { flatten: true, minimumConfidence, strategy }),
            );
            const lines = (result.results ?? []).map((item) => toLine(item, image));
            trace.event("detect", "inference", { ms: Math.round(detectionRuns.ms), runs: detectionRuns.runs });
            trace.event("recognize", "inference", {
              lines: lines.length,
              ms: Math.round(recognitionRuns.ms),
              runs: recognitionRuns.runs,
            });
            return { ok: true, value: lines };
          } catch {
            return failure("OCR_FAILED");
          }
        },
      },
      networkAttempts: () => networkAttempts,
    },
  };
}