import { existsSync, readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import * as browser from "../../packages/domain/src/regional-values/browser.js";
import { repoPath } from "../harness/regional-values/importGraph.js";

// Feature: regional-values-map, 10.3: 共同開発者向けの連携ガイドが、実装の公開名と状態に追随していること

const GUIDE_PATH = repoPath(".kiro", "specs", "regional-values-map", "ui-integration-guide.md");
const BROWSER_ENTRY = repoPath("packages", "domain", "src", "regional-values", "browser.ts");

const GUIDE = readFileSync(GUIDE_PATH, "utf8");

/** 見出し（`## ` で始まる行）から、次の同じ階層の見出しの手前までの本文。見出しが無ければ失敗させる。 */
function sectionOf(headingPattern: RegExp): string {
  const lines = GUIDE.split("\n");
  const start = lines.findIndex((line) => line.startsWith("## ") && headingPattern.test(line));
  if (start < 0) {
    throw new Error(`The guide has no section for ${String(headingPattern)}`);
  }
  const length = lines.slice(start + 1).findIndex((line) => line.startsWith("## "));
  return lines.slice(start, length < 0 ? lines.length : start + 1 + length).join("\n");
}

function mentioned(text: string, name: string): boolean {
  return text.includes(`\`${name}\``);
}

function missingFrom(text: string, names: readonly string[]): string[] {
  return names.filter((name) => !mentioned(text, name));
}

type EntryModule = Readonly<{
  checker: ts.TypeChecker;
  source: ts.SourceFile;
  exports: readonly ts.Symbol[];
}>;

/** `browser.ts` を TypeScript のコンパイラで読み、値と型を合わせた公開名を得る。 */
function loadEntryModule(): EntryModule {
  const program = ts.createProgram([BROWSER_ENTRY], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(BROWSER_ENTRY);
  if (source === undefined) {
    throw new Error("browser.ts is not part of the program");
  }
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) {
    throw new Error("browser.ts is not a module");
  }
  return { checker, source, exports: checker.getExportsOfModule(moduleSymbol) };
}

/** 判別共用体 `typeName` の各メンバーが持つ文字列リテラルの値（`type` または `phase`）。 */
function discriminantValues(entry: EntryModule, typeName: string, property: "type" | "phase"): string[] {
  const symbol = entry.exports.find((candidate) => candidate.getName() === typeName);
  if (symbol === undefined) {
    throw new Error(`${typeName} is not exported by browser.ts`);
  }
  const resolved = (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : entry.checker.getAliasedSymbol(symbol);
  const declared = entry.checker.getDeclaredTypeOfSymbol(resolved);
  const members = declared.isUnion() ? declared.types : [declared];
  return members.map((member) => {
    const propertySymbol = member.getProperty(property);
    if (propertySymbol === undefined) {
      throw new Error(`A member of ${typeName} has no ${property}`);
    }
    const propertyType = entry.checker.getTypeOfSymbolAtLocation(propertySymbol, entry.source);
    if (!propertyType.isStringLiteral()) {
      throw new Error(`The ${property} of ${typeName} is not a string literal`);
    }
    return propertyType.value;
  });
}

const ENTRY = loadEntryModule();

describe("the integration guide: the names that browser.ts publishes", () => {
  const names = ENTRY.exports.map((symbol) => symbol.getName()).sort();

  it("reads the public names (values and types) from the entry file", () => {
    expect(names.length).toBeGreaterThan(40);
    for (const name of Object.keys(browser)) {
      expect(names, name).toContain(name);
    }
  });

  it("lists every public name in appendix A", () => {
    expect(missingFrom(sectionOf(/付録A/), names)).toEqual([]);
  });

  it("lists no name in appendix A that browser.ts does not publish", () => {
    const listed = [...sectionOf(/付録A/).matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)].map((match) => match[1] ?? "");
    expect(listed.filter((name) => !names.includes(name))).toEqual([]);
  });

  it("names the types and functions that a screen uses, in the body of the guide", () => {
    const body = GUIDE.slice(0, GUIDE.indexOf("## 付録A"));
    const required = [
      "AnswerValue",
      "Answers",
      "ValuesMap",
      "MapError",
      "DiagnosticState",
      "DiagnosticEvent",
      "diagnosticReducer",
      "QuestionPresentation",
      "presentQuestion",
      "ResultViewModel",
      "buildResultViewModel",
      "CardView",
      "AboutView",
      "loadBundle",
      "ExpectedBundle",
      "VerifiedBundle",
      "LOAD_FAILURE_TEXTS",
    ];
    expect(missingFrom(body, required)).toEqual([]);
  });
});

describe("the integration guide: the state machine", () => {
  const table = sectionOf(/診断の状態遷移/);

  it("reads the events and the phases from the types", () => {
    const events = discriminantValues(ENTRY, "DiagnosticEvent", "type");
    const phases = discriminantValues(ENTRY, "DiagnosticState", "phase");
    expect(events).toContain("START");
    expect(events).toContain("RESTART");
    expect(phases).toContain("QUESTION");
    expect(phases).toContain("UNEXPECTED_ERROR");
  });

  it("mentions every type of DiagnosticEvent in the transition table", () => {
    expect(missingFrom(table, discriminantValues(ENTRY, "DiagnosticEvent", "type"))).toEqual([]);
  });

  it("mentions every phase of DiagnosticState in the transition table", () => {
    expect(missingFrom(table, discriminantValues(ENTRY, "DiagnosticState", "phase"))).toEqual([]);
  });
});

describe("the integration guide: the bundle load errors", () => {
  it("lists every code of BUNDLE_LOAD_ERROR_CODES in appendix B", () => {
    expect(missingFrom(sectionOf(/付録B/), browser.BUNDLE_LOAD_ERROR_CODES)).toEqual([]);
  });

  it("states the fixed failure text of each build kind", () => {
    const section = sectionOf(/エラー画面の表示/);
    expect(section).toContain(browser.LOAD_FAILURE_TEXTS.DEMO);
    expect(section).toContain(browser.LOAD_FAILURE_TEXTS.PUBLIC);
    expect(section).toContain(browser.RELOAD_GUIDE_TEXT);
  });
});

describe("the integration guide: the import paths and the commands", () => {
  it("uses the two browser entries and never the package roots", () => {
    expect(GUIDE).toContain("@ehime-vote-navigator/domain/regional-values");
    expect(GUIDE).toContain("@ehime-vote-navigator/contracts/regional");
    expect(GUIDE).not.toMatch(/from "@ehime-vote-navigator\/(domain|contracts)"/);
  });

  it("names the command, the options and the output of the build", () => {
    for (const text of [
      "regional-values -- build",
      "--config-dir",
      "--data-mode",
      "--generated-at",
      "tests/harness/regional-values/test-config",
      "dist/regional-values/<kind>/bundle.json",
      "/regional-values/bundle.json",
    ]) {
      expect(GUIDE, text).toContain(text);
    }
  });

  it("says that the answers are not sent and not stored, and what the screen must not do", () => {
    const section = sectionOf(/外部送信しない制約/);
    for (const text of ["fetch", "sendBeacon", "localStorage", "sessionStorage", "IndexedDB", "URL", "console"]) {
      expect(section, text).toContain(text);
    }
    expect(sectionOf(/画面からの禁止事項/)).toContain("AnswerValue");
  });

  it("separates FIXTURE from REAL_AI", () => {
    const section = sectionOf(/FIXTURE.*REAL_AI/);
    for (const text of ["meta.dataKind", "FIXTURE", "REAL_AI", "banner"]) {
      expect(section, text).toContain(text);
    }
  });

  it("refers only to files that exist in the repository", () => {
    const paths = [...GUIDE.matchAll(/`([A-Za-z0-9_.\-/]+\.(?:ts|tsx|json|md|mjs))`/g)]
      .map((match) => match[1] ?? "")
      .filter((path) => path.includes("/") && !path.startsWith("/") && !path.startsWith("dist/"));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((path) => !existsSync(repoPath(...path.split("/"))))).toEqual([]);
  });

  it("refers to the directories of the test-only settings and of the fictional data", () => {
    for (const directory of [
      ["tests", "harness", "regional-values", "test-config"],
      ["packages", "fixtures", "src", "regional-values"],
    ]) {
      expect(existsSync(repoPath(...directory)), directory.join("/")).toBe(true);
    }
  });
});
