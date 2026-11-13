import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BUNDLE_SCHEMA_VERSION,
  FixedTextsSchema,
  GuidanceQuestionSchema,
  IssueCardSchema,
  MapConfigSchema,
  QuestionBankSchema,
  RegionalBundleSchema,
  ResultTextSchema,
} from "@ehime-vote-navigator/contracts";
import { calculateContentHash } from "./contentHash.js";
import { BUNDLE_GET_INIT, MAX_BUNDLE_BYTES, loadBundle } from "./loadBundle.js";
import { LOAD_FAILURE_TEXTS } from "./loadFailureTexts.js";
import type { ExpectedBundle, HttpGet } from "./index.js";

const DIRECTORY = new URL("../../../../fixtures/src/regional-values/", import.meta.url);
const HASH = "a".repeat(64);
const EXPECTED: ExpectedBundle = { schemaVersion: BUNDLE_SCHEMA_VERSION, dataVersion: "2026-01-01.1", buildKind: "DEMO" };

function source(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(name, DIRECTORY)), "utf8")) as unknown;
}

async function validText(): Promise<string> {
  const bank = QuestionBankSchema.parse(source("question-bank.json"));
  const raw = {
    meta: { schemaVersion: 1, generatedAt: "2026-01-04T09:00:00Z", dataVersion: EXPECTED.dataVersion, buildKind: "DEMO", dataKind: "FIXTURE", dataModeRequested: "FIXTURE", dataModeResolved: "FIXTURE", switched: false, switchReasonCodes: [], contentHash: HASH },
    themes: bank.themes,
    questions: bank.questions,
    diagnosticSets: bank.diagnosticSets,
    cards: IssueCardSchema.array().parse(source("cards.json")),
    resultTexts: ResultTextSchema.array().parse(source("result-texts.json")),
    fixedTexts: FixedTextsSchema.parse(source("fixed-texts.json")),
    guidance: GuidanceQuestionSchema.array().parse(source("guidance.json")),
    mapConfig: MapConfigSchema.parse({ thresholds: { t1: 50, t2: 150 }, guidanceMaxThemes: 3 }),
    aiContribution: { drafted: 0, rejectedByChecks: 0, humanEdited: 0, humanRejected: 0 },
  };
  const parsed = RegionalBundleSchema.parse(raw);
  const contentHash = await calculateContentHash(parsed);
  return JSON.stringify({ ...parsed, meta: { ...parsed.meta, contentHash } });
}

function getOf(body: string, ok = true) {
  const calls: { url: string; init: typeof BUNDLE_GET_INIT }[] = [];
  const httpGet: HttpGet = async (url, init) => {
    calls.push({ url, init });
    return { ok, text: async () => body };
  };
  return { calls, httpGet };
}

describe("loadBundle", () => {
  it("uses exactly one credential-free GET with no redirect, then returns a verified bundle", async () => {
    const { calls, httpGet } = getOf(await validText());
    const result = await loadBundle({ httpGet, url: "/regional-values/bundle.json", expected: EXPECTED });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ url: "/regional-values/bundle.json", init: BUNDLE_GET_INIT }]);
  });

  it("maps a rejected GET, a non-OK response and an unreadable body to FETCH_FAILED", async () => {
    const rejected: HttpGet = async () => Promise.reject(new Error("unavailable"));
    await expect(loadBundle({ httpGet: rejected, url: "/bundle", expected: EXPECTED })).resolves.toEqual({ ok: false, error: "FETCH_FAILED" });
    const nonOk = getOf("unused", false);
    await expect(loadBundle({ httpGet: nonOk.httpGet, url: "/bundle", expected: EXPECTED })).resolves.toEqual({ ok: false, error: "FETCH_FAILED" });
    expect(nonOk.calls).toHaveLength(1);
    const unreadable: HttpGet = async () => ({ ok: true, text: async () => Promise.reject(new Error("unreadable")) });
    await expect(loadBundle({ httpGet: unreadable, url: "/bundle", expected: EXPECTED })).resolves.toEqual({ ok: false, error: "FETCH_FAILED" });
  });

  it("rejects a body over two million UTF-8 bytes before parsing it", async () => {
    const tooLarge = "あ".repeat(Math.ceil((MAX_BUNDLE_BYTES + 1) / 3));
    const { calls, httpGet } = getOf(tooLarge);
    await expect(loadBundle({ httpGet, url: "/bundle", expected: EXPECTED })).resolves.toEqual({ ok: false, error: "TOO_LARGE" });
    expect(calls).toHaveLength(1);
  });

  it("keeps the verifier error and does not return any response content", async () => {
    const { calls, httpGet } = getOf("not JSON: secret response");
    const result = await loadBundle({ httpGet, url: "/bundle", expected: EXPECTED });
    expect(result).toEqual({ ok: false, error: "NOT_JSON" });
    expect(JSON.stringify(result)).not.toContain("secret response");
    expect(calls).toHaveLength(1);
  });

  it("does not contain a direct fetch call in its domain source", () => {
    const source = readFileSync(fileURLToPath(new URL("./loadBundle.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(/u);
  });
});

describe("LOAD_FAILURE_TEXTS", () => {
  it("gives the demo a failure message and public a preparation message only", () => {
    expect(LOAD_FAILURE_TEXTS).toEqual({ DEMO: "データの読み込みに失敗しました。", PUBLIC: "準備中" });
  });

  it("has none of the words that would suggest a candidate, a ranking or a recommendation", () => {
    for (const text of Object.values(LOAD_FAILURE_TEXTS)) {
      for (const banned of ["推奨", "おすすめ", "一致", "順位", "ランク", "あなたに合"]) {
        expect(text).not.toContain(banned);
      }
    }
  });
});