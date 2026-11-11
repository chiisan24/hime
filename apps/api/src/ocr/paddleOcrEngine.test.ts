import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { sha256Hex } from "@ehime-vote-navigator/domain";
import { describe, expect, it } from "vitest";

import { withTemporaryTestDirectory } from "../../../../tests/harness/temporary-directory.js";
import type { OcrModelSet } from "./modelManifest.js";
import { OCR_RUNTIME_VERSIONS, PP_OCRV5_SERVER } from "./modelManifest.js";
import { createPaddleOcrEngine, type PaddleItem, type PaddleService } from "./paddleOcrEngine.js";
import { createTracer } from "./trace.js";
import type { PageImage } from "./ocrTypes.js";

const DET = new TextEncoder().encode("fake detection model");
const REC = new TextEncoder().encode("fake recognition model");
const YML = new TextEncoder().encode("PostProcess:\n  character_dict:\n  - あ\n  - い\n  - う\n");

function pinned(directory: string, file: string, bytes: Uint8Array) {
  return { bytes: bytes.byteLength, directory, file, sha256: sha256Hex(bytes), url: `https://example.test/${directory}/${file}` };
}

const MODEL_SET: OcrModelSet = {
  detection: pinned("det", "inference.onnx", DET),
  dictionaryEntries: 3,
  id: "Fake_OCR",
  license: "Apache-2.0",
  recognition: pinned("rec", "inference.onnx", REC),
  recognitionConfig: pinned("rec", "inference.yml", YML),
};

async function writeModels(root: string): Promise<void> {
  await mkdir(join(root, "det"), { recursive: true });
  await mkdir(join(root, "rec"), { recursive: true });
  await writeFile(join(root, "det", "inference.onnx"), DET);
  await writeFile(join(root, "rec", "inference.onnx"), REC);
  await writeFile(join(root, "rec", "inference.yml"), YML);
}

const IMAGE: PageImage = {
  dpi: 300,
  height: 200,
  page: 2,
  png: new Uint8Array([1, 2, 3]),
  region: { x0: 0.5, x1: 0.9, y0: 0.2, y1: 0.4 },
  width: 400,
};

function fakeFactory(items: readonly PaddleItem[], hooks: { onOptions?: (options: Record<string, unknown>) => void; onRecognize?: () => Promise<void>; fail?: boolean } = {}) {
  return async (options: Record<string, unknown>): Promise<PaddleService> => {
    hooks.onOptions?.(options);
    return {
      destroy: async () => undefined,
      initialize: async () => undefined,
      recognize: async () => {
        await hooks.onRecognize?.();
        if (hooks.fail === true) {
          throw new Error("boom");
        }
        return { results: items };
      },
    };
  };
}

describe("createPaddleOcrEngine", () => {
  it("verifies the model files and gives the service verified bytes and a dictionary from inference.yml", async () => {
    await withTemporaryTestDirectory(async (root) => {
      await writeModels(root);
      let seen: Record<string, unknown> = {};

      const session = await createPaddleOcrEngine({
        createService: fakeFactory([], { onOptions: (options) => { seen = options; } }),
        modelRoot: root,
        modelSet: MODEL_SET,
      });

      expect(session.ok).toBe(true);
      const model = seen.model as Record<string, ArrayBuffer>;
      expect(new TextDecoder().decode(model.charactersDictionary)).toBe("あ\nい\nう");
      expect(new Uint8Array(model.detection ?? new ArrayBuffer(0))).toEqual(DET);
      expect(new Uint8Array(model.recognition ?? new ArrayBuffer(0))).toEqual(REC);
      expect(session.ok && session.value.engine.id).toBe(
        `ppu-paddle-ocr@${OCR_RUNTIME_VERSIONS.ppuPaddleOcr}+onnxruntime-node@${OCR_RUNTIME_VERSIONS.onnxruntimeNode}+Fake_OCR(det:${MODEL_SET.detection.sha256.slice(0, 8)},rec:${MODEL_SET.recognition.sha256.slice(0, 8)})+per-line`,
      );
    }, "paddle-engine-verify");
  });

  it("refuses a missing, altered or mismatching model", async () => {
    await withTemporaryTestDirectory(async (root) => {
      const missing = await createPaddleOcrEngine({ createService: fakeFactory([]), modelRoot: root, modelSet: MODEL_SET });
      await writeModels(root);
      await writeFile(join(root, "det", "inference.onnx"), new TextEncoder().encode("fake detection modeL"));
      const altered = await createPaddleOcrEngine({ createService: fakeFactory([]), modelRoot: root, modelSet: MODEL_SET });
      await writeModels(root);
      const wrongCount = await createPaddleOcrEngine({
        createService: fakeFactory([]),
        modelRoot: root,
        modelSet: { ...MODEL_SET, dictionaryEntries: 4 },
      });

      for (const result of [missing, altered, wrongCount]) {
        expect(result).toEqual({ ok: false, error: { code: "OCR_MODEL_INVALID" } });
      }
    }, "paddle-engine-invalid");
  });

  it("maps boxes into page coordinates and detects vertical lines", async () => {
    await withTemporaryTestDirectory(async (root) => {
      await writeModels(root);
      const session = await createPaddleOcrEngine({
        createService: fakeFactory([
          { box: { height: 20, width: 100, x: 0, y: 0 }, confidence: 0.91, text: "教 育 に つ い て" },
          { box: { height: 100, width: 20, x: 400, y: 100 }, confidence: 1.4, text: "縦書き" },
          { box: { height: 100, width: 20, x: 100, y: 100 }, confidence: 0.5, text: "字" },
          { box: { height: 20, width: 100, x: 0, y: 150 }, confidence: 0.7, text: "Plan A" },
        ]),
        modelRoot: root,
        modelSet: MODEL_SET,
      });
      if (!session.ok) {
        throw new Error("engine did not start");
      }

      const result = await session.value.engine.recognize(IMAGE);

      const lines = result.ok ? result.value : [];
      const expected = [
        { box: [0.5, 0.6, 0.2, 0.22], confidence: 0.91, orientation: "horizontal", text: "教育について" },
        { box: [0.9, 0.92, 0.3, 0.4], confidence: 1, orientation: "vertical", text: "縦書き" },
        { box: [0.6, 0.62, 0.3, 0.4], confidence: 0.5, orientation: "horizontal", text: "字" },
        { box: [0.5, 0.6, 0.35, 0.37], confidence: 0.7, orientation: "horizontal", text: "Plan A" },
      ] as const;
      expect(lines).toHaveLength(expected.length);
      expected.forEach((want, index) => {
        const line = lines[index];
        expect([line?.text, line?.orientation, line?.confidence]).toEqual([want.text, want.orientation, want.confidence]);
        expect(line?.box.x0).toBeCloseTo(want.box[0], 6);
        expect(line?.box.x1).toBeCloseTo(want.box[1], 6);
        expect(line?.box.y0).toBeCloseTo(want.box[2], 6);
        expect(line?.box.y1).toBeCloseTo(want.box[3], 6);
      });
    }, "paddle-engine-map");
  });

  it("blocks and counts network access while the service runs, then restores fetch", async () => {
    await withTemporaryTestDirectory(async (root) => {
      await writeModels(root);
      const original = globalThis.fetch;
      let blocked = "";
      const session = await createPaddleOcrEngine({
        createService: fakeFactory([], {
          onRecognize: async () => {
            blocked = await globalThis.fetch("https://example.test/model").then(() => "allowed", () => "blocked");
          },
        }),
        modelRoot: root,
        modelSet: MODEL_SET,
      });
      if (!session.ok) {
        throw new Error("engine did not start");
      }

      await session.value.engine.recognize(IMAGE);

      expect(blocked).toBe("blocked");
      expect(session.value.networkAttempts?.()).toBe(1);
      expect(globalThis.fetch).toBe(original);
    }, "paddle-engine-network");
  });

  it("reports a failing service as OCR_FAILED and a failing start as OCR_ENGINE_UNAVAILABLE", async () => {
    await withTemporaryTestDirectory(async (root) => {
      await writeModels(root);
      const failing = await createPaddleOcrEngine({ createService: fakeFactory([], { fail: true }), modelRoot: root, modelSet: MODEL_SET });
      const unavailable = await createPaddleOcrEngine({
        createService: async () => {
          throw new Error("no runtime");
        },
        modelRoot: root,
        modelSet: MODEL_SET,
      });

      expect(failing.ok && (await failing.value.engine.recognize(IMAGE))).toEqual({ ok: false, error: { code: "OCR_FAILED" } });
      expect(unavailable).toEqual({ ok: false, error: { code: "OCR_ENGINE_UNAVAILABLE" } });
    }, "paddle-engine-failure");
  });
});

describe("createPaddleOcrEngine strategy and tracing", () => {
  it("passes the strategy to the service and names it in the engine id", async () => {
    await withTemporaryTestDirectory(async (root) => {
      await writeModels(root);
      const seen: Array<Record<string, unknown>> = [];
      const session = await createPaddleOcrEngine({
        createService: async () => ({
          destroy: async () => undefined,
          initialize: async () => undefined,
          recognize: async (_image, options) => {
            seen.push(options);
            return { results: [] };
          },
        }),
        modelRoot: root,
        modelSet: MODEL_SET,
        strategy: "per-box",
      });
      if (!session.ok) {
        throw new Error("engine did not start");
      }

      await session.value.engine.recognize(IMAGE);

      expect(seen).toEqual([{ flatten: true, minimumConfidence: 0.3, strategy: "per-box" }]);
      expect(session.value.engine.id.endsWith("+per-box")).toBe(true);
      expect(session.value.engine.id).not.toContain("per-line");
    }, "paddle-engine-strategy");
  });

  it("times detection and recognition inference when tracing, with counts only", async () => {
    await withTemporaryTestDirectory(async (root) => {
      await writeModels(root);
      const lines: string[] = [];
      const original = (name: string) => ({ calls: [] as string[], run: async () => name });
      const detectionSession = original("det");
      const recognitionSession = original("rec");
      const tracer = createTracer({ enabled: true, write: (line) => lines.push(line) });
      const session = await createPaddleOcrEngine({
        createService: async () => {
          const service: PaddleService = {
            destroy: async () => undefined,
            detectionSession,
            initialize: async () => undefined,
            recognitionSession,
            recognize: async () => {
              await detectionSession.run();
              await recognitionSession.run();
              await recognitionSession.run();
              return { results: [{ box: { height: 20, width: 100, x: 0, y: 0 }, confidence: 0.9, text: "SECRET-TEXT-MARKER" }] };
            },
          };
          return service;
        },
        modelRoot: root,
        modelSet: MODEL_SET,
        trace: tracer,
      });
      if (!session.ok) {
        throw new Error("engine did not start");
      }

      const result = await session.value.engine.recognize(IMAGE);
      tracer.stop();

      expect(result.ok && result.value[0]?.text).toBe("SECRET-TEXT-MARKER");
      const text = lines.join("\n");
      expect(text).toMatch(/model-load verified rssMb=\d+ ms=\d+/u);
      expect(text).toMatch(/model-load initialized rssMb=\d+ ms=\d+/u);
      expect(text).toMatch(/detect inference rssMb=\d+ ms=\d+ runs=1/u);
      expect(text).toMatch(/recognize inference rssMb=\d+ lines=1 ms=\d+ runs=2/u);
      expect(text).not.toContain("SECRET");
    }, "paddle-engine-trace");
  });
});
describe("pinned model set", () => {
  it("names official PaddlePaddle repositories with hashes and a commit in every address", () => {
    for (const file of [PP_OCRV5_SERVER.detection, PP_OCRV5_SERVER.recognition, PP_OCRV5_SERVER.recognitionConfig]) {
      expect(file.url).toMatch(/^https:\/\/huggingface\.co\/PaddlePaddle\/PP-OCRv5_server_(det|rec)_onnx\/resolve\/[0-9a-f]{40}\/inference\.(onnx|yml)$/u);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(file.bytes).toBeGreaterThan(0);
    }
    expect(PP_OCRV5_SERVER.license).toBe("Apache-2.0");
  });
});