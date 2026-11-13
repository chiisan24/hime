import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BUILD_CONFIG_FILE_NAME,
  NEUTRALITY_CONFIG_FILE_NAME,
  loadBuildConfig,
  loadNeutralityConfig,
} from "./loadConfig.js";

function neutrality(overrides: Record<string, unknown> = {}) {
  return {
    candidateAndPartyNames: [], incumbencyWords: ["現職"], doubleQuestionWords: ["かつ"], loadedWords: ["優劣語", "推奨語", "投票語"],
    labelLengthDiffMax: 6, directionLengthDiffMax: 20, policyNames: [], budgetStanceWords: ["予算"],
    importanceTemplate: "{テーマ名}は、あなたの暮らしにとってどのくらい大切ですか",
    premiseTemplates: ["限られた条件で、どちらかを先に進める場面を考えてください"],
    negationWords: ["しない"], exclusiveWords: ["だけ"], disparagingWords: ["軽視"],
    bannedWords: ["優劣語", "推奨語", "投票語"], numeralExemptWords: ["一方"],
    wordCategories: { SUPERIORITY: ["優劣語"], RECOMMENDATION: ["推奨語"], VOTE_URGING: ["投票語"] },
    guidanceNames: [], choiceEncouragingWords: [], userClaimPatterns: ["あなたは"], ...overrides,
  };
}

function build(overrides: Record<string, unknown> = {}) {
  return { dataVersion: "2026-01-01.1", quoteMaxChars: 200, realNames: [], properNouns: [], requiredApprovers: 1, ...overrides };
}
let configDir: string;

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "regional-values-check-config-"));
});

afterEach(async () => {
  await rm(configDir, { recursive: true, force: true });
});

async function write(name: string, value: unknown): Promise<void> {
  await writeFile(join(configDir, name), JSON.stringify(value), "utf8");
}

describe("loadNeutralityConfig", () => {
  it("reads a complete test-only configuration", async () => {
    await write(NEUTRALITY_CONFIG_FILE_NAME, neutrality());
    expect(await loadNeutralityConfig(configDir)).toEqual({ ok: true, value: neutrality() });
  });

  it("rejects a missing file, broken JSON and contract violation without revealing the path or content", async () => {
    expect(await loadNeutralityConfig(configDir)).toEqual({ ok: false, error: { code: "CONFIG_UNREADABLE", file: "neutrality.json" } });
    await writeFile(join(configDir, NEUTRALITY_CONFIG_FILE_NAME), "{", "utf8");
    expect(await loadNeutralityConfig(configDir)).toEqual({ ok: false, error: { code: "CONFIG_UNREADABLE", file: "neutrality.json" } });
    await write(NEUTRALITY_CONFIG_FILE_NAME, neutrality({ loadedWords: [] }));
    expect(await loadNeutralityConfig(configDir)).toEqual({ ok: false, error: { code: "CONFIG_UNREADABLE", file: "neutrality.json" } });
  });

  it("rejects a category word absent from bannedWords or loadedWords", async () => {
    await write(NEUTRALITY_CONFIG_FILE_NAME, neutrality({ bannedWords: ["優劣語", "推奨語"] }));
    expect(await loadNeutralityConfig(configDir)).toEqual({ ok: false, error: { code: "CONFIG_UNREADABLE", file: "neutrality.json" } });
    await write(NEUTRALITY_CONFIG_FILE_NAME, neutrality({ loadedWords: ["優劣語", "投票語"] }));
    expect(await loadNeutralityConfig(configDir)).toEqual({ ok: false, error: { code: "CONFIG_UNREADABLE", file: "neutrality.json" } });
  });
});

describe("loadBuildConfig", () => {
  it("reads a valid test-only build configuration", async () => {
    await write(BUILD_CONFIG_FILE_NAME, build());
    expect(await loadBuildConfig(configDir)).toEqual({ ok: true, value: build() });
  });

  it("rejects missing, invalid and malformed files by base name only", async () => {
    expect(await loadBuildConfig(configDir)).toEqual({ ok: false, error: { code: "CONFIG_UNREADABLE", file: "build.json" } });
    await write(BUILD_CONFIG_FILE_NAME, build({ dataVersion: "wrong" }));
    expect(await loadBuildConfig(configDir)).toEqual({ ok: false, error: { code: "CONFIG_UNREADABLE", file: "build.json" } });
    await writeFile(join(configDir, BUILD_CONFIG_FILE_NAME), "{", "utf8");
    expect(await loadBuildConfig(configDir)).toEqual({ ok: false, error: { code: "CONFIG_UNREADABLE", file: "build.json" } });
  });
});