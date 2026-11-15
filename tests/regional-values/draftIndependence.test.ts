import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import type { EvidenceUnit } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import type { DraftInputMaterial } from "../../apps/api/src/regional-values/draft/checkDraftInput.js";
import { DraftRequestSchema } from "../../apps/api/src/regional-values/draft/request.js";
import type { DraftRequest } from "../../apps/api/src/regional-values/draft/request.js";
import { collectClosure, exportedNames, repoPath } from "../harness/regional-values/importGraph.js";

/**
 * The AI draft process does not touch the calculation of the values map (Req 8.2, 8.3, 12.18). Two
 * things show it. The modules of the process, and everything that they take in, do not take in the
 * modules of the map, the session and the view of the domain. And the types of the input of a draft
 * have no place for the answers of a user, the values map or the state of the diagnosis.
 *
 * The same check for the modules of the issues (`issues/`) is added at 16.11, to this file.
 */

const DRAFT_DIRECTORY = repoPath("apps", "api", "src", "regional-values", "draft");
const DOMAIN_REGIONAL = repoPath("packages", "domain", "src", "regional-values");
const FORBIDDEN_FOLDERS = ["map", "session", "view"] as const;

/** The names of the contract of the map, which an input of a draft does not take. */
const MAP_CONTRACT_NAMES: readonly string[] = [
  "Answers",
  "AnswerValue",
  "PickAnswer",
  "MapInput",
  "MapQuestion",
  "ValuesMap",
  "AxisState",
  "PriorityState",
  "MapError",
  "DiagnosticState",
];

function sourceFilesOf(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => join(directory, name))
    .sort();
}

const draftFiles = sourceFilesOf(DRAFT_DIRECTORY);

/** Every name that a module of `map/`, `session/` or `view/` of the domain exports. */
function namesOfMapSessionView(): Set<string> {
  const names = new Set<string>();
  for (const folder of FORBIDDEN_FOLDERS) {
    for (const file of sourceFilesOf(join(DOMAIN_REGIONAL, folder))) {
      for (const name of exportedNames(readFileSync(file, "utf8"))) {
        names.add(name);
      }
    }
  }
  return names;
}

describe("the AI draft process and the calculation of the values map", () => {
  it("has modules to check", () => {
    expect(draftFiles.length).toBeGreaterThanOrEqual(10);
    expect(draftFiles.map((file) => relative(DRAFT_DIRECTORY, file).replaceAll("\\", "/"))).toEqual(
      expect.arrayContaining(["runDraft.ts", "checkDraftInput.ts", "checks.ts", "review.ts", "approvalLedger.ts", "contribution.ts", "prompts/index.ts"]),
    );
  });

  it("does not take in a module of the map, the session or the view, directly or through the modules that it takes in", () => {
    const reached = new Set<string>();
    for (const file of draftFiles) {
      for (const reachedFile of collectClosure(file).files) {
        reached.add(reachedFile.replaceAll("\\", "/"));
      }
    }
    expect(reached.size).toBeGreaterThan(draftFiles.length);
    const forbidden = [...reached].filter((file) => FORBIDDEN_FOLDERS.some((folder) => file.includes(`/packages/domain/src/regional-values/${folder}/`)));
    expect(forbidden).toEqual([]);
  });

  it("takes from the package of the domain no name of the map, the session or the view", () => {
    const forbiddenNames = namesOfMapSessionView();
    // The check finds something to look for.
    expect(forbiddenNames.has("generateValuesMap")).toBe(true);
    expect(forbiddenNames.has("diagnosticReducer")).toBe(true);
    expect(forbiddenNames.has("buildResultViewModel")).toBe(true);

    const found: string[] = [];
    for (const file of draftFiles) {
      for (const record of collectClosure(file).imports) {
        if (!record.specifier.startsWith("@ehime-vote-navigator/domain")) {
          continue;
        }
        for (const name of record.names) {
          if (name === "*" || forbiddenNames.has(name)) {
            found.push(`${relative(DRAFT_DIRECTORY, record.file).replaceAll("\\", "/")} imports ${name}`);
          }
        }
      }
    }
    expect([...new Set(found)]).toEqual([]);
  });

  it("takes no type of the answers, the values map or the diagnosis from anywhere", () => {
    const found: string[] = [];
    for (const file of draftFiles) {
      for (const record of collectClosure(file).imports) {
        for (const name of record.names) {
          if (MAP_CONTRACT_NAMES.includes(name)) {
            found.push(`${relative(DRAFT_DIRECTORY, record.file).replaceAll("\\", "/")} imports ${name}`);
          }
        }
      }
    }
    expect([...new Set(found)]).toEqual([]);
  });

  it("has an input that has no place for the answers of a user, the priority theme, the values map or a free text", () => {
    const valid = { task: "ISSUE_CANDIDATE", dataKind: "FIXTURE", facts: [], evidence: [], sources: [] };
    expect(DraftRequestSchema.safeParse(valid).success).toBe(true);
    for (const extra of [
      { answers: {} },
      { userAnswers: [] },
      { priorityTheme: "TRANSPORT" },
      { priorityThemeId: "TRANSPORT" },
      { valuesMap: {} },
      { diagnosticState: { phase: "RESULT" } },
      { freeText: "text" },
      { userInput: "text" },
    ]) {
      expect(DraftRequestSchema.safeParse({ ...valid, ...extra }).success, Object.keys(extra).join()).toBe(false);
    }
  });

  it("does not take them in the types either (the lines that say so are checked by the compiler)", () => {
    const request: DraftRequest = {
      task: "ISSUE_CANDIDATE",
      dataKind: "FIXTURE",
      facts: [],
      evidence: [],
      sources: [],
      // @ts-expect-error the request of a draft has no field for the answers of a user
      answers: {},
    };
    const withMap: DraftRequest = {
      task: "ISSUE_CANDIDATE",
      dataKind: "FIXTURE",
      facts: [],
      evidence: [],
      sources: [],
      // @ts-expect-error the request of a draft has no field for the values map
      valuesMap: {},
    };
    const material: DraftInputMaterial = {
      task: "ISSUE_CANDIDATE",
      dataKind: "FIXTURE",
      system: "",
      text: "",
      materials: [],
      facts: [],
      evidence: [],
      sources: [],
      factRegistry: [],
      // @ts-expect-error the material of an input has no field for the state of the diagnosis
      diagnosticState: { phase: "LOADING" },
    };
    const unit: EvidenceUnit = {
      evidenceId: "E1",
      sourceId: "fictional-doc-1",
      locator: { kind: "text-lines", startLine: 1, endLine: 2 },
      text: "引用",
      // @ts-expect-error a quotation has no field for the priority theme
      priorityTheme: "TRANSPORT",
    };
    expect([request, withMap, material, unit]).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// The issues (16.11, Property 63: the part that is checked on the source)
// ---------------------------------------------------------------------------

const ISSUES_DIRECTORY = repoPath("apps", "api", "src", "regional-values", "issues");
const GATE_DIRECTORY = join(DOMAIN_REGIONAL, "gate");

const issueFiles = sourceFilesOf(ISSUES_DIRECTORY);
const linkFiles = ["checkIssueLinks.ts", "applyIssueValidity.ts"].map((name) => join(GATE_DIRECTORY, name));

function closureOf(files: readonly string[]): Set<string> {
  const reached = new Set<string>();
  for (const file of files) {
    for (const reachedFile of collectClosure(file).files) {
      reached.add(reachedFile.replaceAll("\\", "/"));
    }
  }
  return reached;
}

function importsOfForbiddenNames(files: readonly string[], base: string): string[] {
  const forbiddenNames = namesOfMapSessionView();
  const found: string[] = [];
  for (const file of files) {
    for (const record of collectClosure(file).imports) {
      if (!record.specifier.startsWith("@ehime-vote-navigator/domain")) {
        continue;
      }
      for (const name of record.names) {
        if (name === "*" || forbiddenNames.has(name)) {
          found.push(`${relative(base, record.file).replaceAll("\\", "/")} imports ${name}`);
        }
      }
    }
  }
  return [...new Set(found)];
}

describe("the issues and the calculation of the values map (Req 12.18, 13.1)", () => {
  it("has modules to check", () => {
    expect(issueFiles.map((file) => relative(ISSUES_DIRECTORY, file).replaceAll("\\", "/"))).toEqual(
      expect.arrayContaining(["loadIssueSnapshot.ts", "exportIssues.ts", "issuesFile.ts", "receipt.ts", "inputs.ts"]),
    );
    expect(linkFiles.every((file) => readFileSync(file, "utf8").length > 0)).toBe(true);
  });

  it("does not take in a module of the map, the session or the view, directly or through the modules that it takes in", () => {
    const reached = closureOf(issueFiles);
    expect(reached.size).toBeGreaterThan(issueFiles.length);
    const forbidden = [...reached].filter((file) => FORBIDDEN_FOLDERS.some((folder) => file.includes(`/packages/domain/src/regional-values/${folder}/`)));
    expect(forbidden).toEqual([]);
  });

  it("takes from the package of the domain no name of the map, the session or the view", () => {
    expect(importsOfForbiddenNames(issueFiles, ISSUES_DIRECTORY)).toEqual([]);
  });

  it("takes no type of the answers, the values map or the diagnosis from anywhere", () => {
    const found: string[] = [];
    for (const file of issueFiles) {
      for (const record of collectClosure(file).imports) {
        for (const name of record.names) {
          if (MAP_CONTRACT_NAMES.includes(name)) {
            found.push(`${relative(ISSUES_DIRECTORY, record.file).replaceAll("\\", "/")} imports ${name}`);
          }
        }
      }
    }
    expect([...new Set(found)]).toEqual([]);
  });

  it("has the check of the record of links and the validity of a card apart from the map: no module of the map, the session or the view, and no name of them", () => {
    const reached = closureOf(linkFiles);
    expect(reached.size).toBeGreaterThanOrEqual(linkFiles.length);
    expect([...reached].filter((file) => FORBIDDEN_FOLDERS.some((folder) => file.includes(`/packages/domain/src/regional-values/${folder}/`)))).toEqual([]);
    expect(importsOfForbiddenNames(linkFiles, GATE_DIRECTORY)).toEqual([]);
  });

  it("is not taken in by the map, the session or the view, nor by the entry of the browser", () => {
    const toIssues = (file: string): boolean => /\/apps\/api\/src\/regional-values\/(issues|draft)\//u.test(file.replaceAll("\\", "/"));
    for (const folder of FORBIDDEN_FOLDERS) {
      for (const file of sourceFilesOf(join(DOMAIN_REGIONAL, folder))) {
        expect([...collectClosure(file).files].filter(toIssues), file).toEqual([]);
      }
    }
    expect([...collectClosure(join(DOMAIN_REGIONAL, "browser.ts")).files].filter(toIssues)).toEqual([]);
  });
});
