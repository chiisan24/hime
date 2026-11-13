import { builtinModules } from "node:module";
import { relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectClosure,
  findForbiddenUses,
  findNodeGlobals,
  repoPath,
} from "../../../../tests/harness/regional-values/importGraph.js";

// Feature: regional-values-map, Property 52: 依存閉包
// **Validates: Requirements 4.1, 9.6, 12.9**

const CONTRACTS = "@ehime-vote-navigator/contracts";
const DOMAIN_SRC = repoPath("packages", "domain", "src");

const closure = collectClosure(repoPath("packages", "domain", "src", "regional-values", "browser.ts"));
const contractsRoot = collectClosure(repoPath("packages", "contracts", "src", "index.ts"));
const contractsRegional = collectClosure(
  repoPath("packages", "contracts", "src", "models", "regional", "index.ts"),
);

/** The only modules that browser.ts may reach, as paths below packages/domain/src. */
const ALLOWED_DOMAIN_FILES =
  /^(result\.ts|regional-values\/(browser\.ts|(map|session|view)\/.+\.ts|bundle\/(contentHash|portableCanonicalJson|verifyBundleText|loadBundle|loadFailureTexts)\.ts))$/u;

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:") || builtinModules.includes(specifier);
}

function belowDomainSrc(file: string): string {
  return relative(DOMAIN_SRC, file).replaceAll("\\", "/");
}

describe("browser.ts: the modules reachable from the entry", () => {
  it("are the calculation, session, view and bundle verification modules", () => {
    const names = closure.files.map(belowDomainSrc);
    for (const expected of [
      "regional-values/browser.ts",
      "regional-values/map/generateValuesMap.ts",
      "regional-values/session/diagnosticReducer.ts",
      "regional-values/session/presentQuestion.ts",
      "regional-values/view/buildResultViewModel.ts",
      "regional-values/bundle/loadBundle.ts",
      "regional-values/bundle/verifyBundleText.ts",
      "regional-values/bundle/contentHash.ts",
      "regional-values/bundle/portableCanonicalJson.ts",
      "regional-values/bundle/loadFailureTexts.ts",
      "result.ts",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("include no question bank check, content check, gate, bundle assembly or other domain module", () => {
    const outside = closure.files.map(belowDomainSrc).filter((name) => !ALLOWED_DOMAIN_FILES.test(name));
    expect(outside).toEqual([]);
  });

  it("import no Node.js module and no package other than the contracts", () => {
    for (const record of closure.imports) {
      expect(isNodeBuiltin(record.specifier), `${record.specifier} in ${record.file}`).toBe(false);
      if (!record.specifier.startsWith(".")) {
        expect(record.specifier, record.file).toBe(CONTRACTS);
      }
    }
  });

  it("use no Buffer, process or require", () => {
    for (const [file, text] of closure.sources) {
      expect(findNodeGlobals(text), file).toEqual([]);
    }
  });

  it("read no current time, take no random number and reference no network API", () => {
    for (const [file, text] of closure.sources) {
      expect(findForbiddenUses(text), file).toEqual([]);
    }
  });
});

describe("browser.ts: the contracts that it imports", () => {
  it("reach the schemas that the bundle verification needs", () => {
    const names = contractsRegional.files.map((file) => relative(repoPath("packages", "contracts", "src"), file).replaceAll("\\", "/"));
    for (const expected of [
      "models/regional/index.ts",
      "models/regional/core.ts",
      "models/regional/config.ts",
      "models/regional/content.ts",
      "models/regional/bundle.ts",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("use no Node.js module, Buffer, process or require, and only zod from outside", () => {
    for (const graph of [contractsRoot, contractsRegional]) {
      for (const record of graph.imports) {
        expect(isNodeBuiltin(record.specifier), `${record.specifier} in ${record.file}`).toBe(false);
        if (!record.specifier.startsWith(".")) {
          expect(record.specifier, record.file).toBe("zod");
        }
      }
      for (const [file, text] of graph.sources) {
        expect(findNodeGlobals(text), file).toEqual([]);
      }
    }
  });
});

describe("browser.ts: the detector for the Node.js globals", () => {
  it("finds Buffer, process and require", () => {
    expect(findNodeGlobals("const a = Buffer.from(x); const b = process.env.A; const c = require('fs');")).toEqual([
      "Buffer",
      "process",
      "require",
    ]);
  });

  it("finds them as a type, as a shorthand property and as a call argument", () => {
    expect(findNodeGlobals("let a: Buffer; const b = { process }; f(require);")).toEqual(["Buffer", "process", "require"]);
  });

  it("does not take a property that has one of these names for a reference", () => {
    expect(
      findNodeGlobals(
        "const a = value.process; const b = { process: 1, require: 2 }; interface X { Buffer: string } class Y { process = 1; require() {} }",
      ),
    ).toEqual([]);
  });
});
