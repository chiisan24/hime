import { builtinModules } from "node:module";

import type { MapInput } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { GOLDEN_VECTORS } from "../../../../../tests/harness/regional-values/goldenVectors.js";
import {
  collectClosure,
  exportedNames,
  findForbiddenUses,
  importsOf,
  repoPath,
} from "../../../../../tests/harness/regional-values/importGraph.js";
import { generateValuesMap } from "./generateValuesMap.js";

const ENTRY = repoPath("packages", "domain", "src", "regional-values", "map", "index.ts");
const CONTRACTS = "@ehime-vote-navigator/contracts";

const closure = collectClosure(ENTRY);

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:") || builtinModules.includes(specifier);
}

describe("map: the modules reachable from map/index.ts", () => {
  it("are the calculation modules and the domain Result type", () => {
    const names = closure.files.map((file) => file.replaceAll("\\", "/").split("/").slice(-2).join("/"));
    for (const expected of [
      "map/index.ts",
      "map/generateValuesMap.ts",
      "map/validateInput.ts",
      "map/axes.ts",
      "map/classify.ts",
      "map/rounding.ts",
      "src/result.ts",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("import no Node.js module, no Bedrock or AWS client and no other package than the contracts", () => {
    for (const record of closure.imports) {
      expect(isNodeBuiltin(record.specifier), `${record.specifier} in ${record.file}`).toBe(false);
      expect(record.specifier).not.toMatch(/bedrock|@aws-sdk|aws/iu);
      if (!record.specifier.startsWith(".")) {
        expect(record.specifier).toBe(CONTRACTS);
      }
    }
  });

  it("use no network, current time or random number", () => {
    for (const [file, text] of closure.sources) {
      expect(findForbiddenUses(text), file).toEqual([]);
    }
  });

  it("reach no module of the issue cards, fact items, sources, content, bundle, view or session", () => {
    for (const file of closure.files) {
      expect(file.replaceAll("\\", "/")).not.toMatch(/\/(content|bundle|view|session|card|source|fact)[^/]*\.ts$|\/(content|bundle|view|session)\//u);
    }
  });

  it("take from the contracts only names that core.ts or primitives.ts defines", () => {
    const allowed = new Set([
      ...exportedNames(
        collectClosure(repoPath("packages", "contracts", "src", "models", "regional", "core.ts")).sources.get(
          repoPath("packages", "contracts", "src", "models", "regional", "core.ts"),
        ) ?? "",
      ),
      ...exportedNames(
        collectClosure(repoPath("packages", "contracts", "src", "models", "primitives.ts")).sources.get(
          repoPath("packages", "contracts", "src", "models", "primitives.ts"),
        ) ?? "",
      ),
    ]);
    expect(allowed.size).toBeGreaterThan(20);
    const taken = closure.imports
      .filter((record) => record.specifier === CONTRACTS)
      .flatMap((record) => record.names);
    expect(taken.length).toBeGreaterThan(0);
    expect(taken.filter((name) => name === "*")).toEqual([]);
    expect(taken.filter((name) => !allowed.has(name))).toEqual([]);
  });
});

describe("map: the detectors themselves", () => {
  it("finds each forbidden construct", () => {
    const cases: [string, string][] = [
      ["Date.now", "const a = Date.now();"],
      ["new Date()", "const a = new Date();"],
      ["performance.now", "const a = performance.now();"],
      ["Math.random", "const a = Math.random();"],
      ["crypto.getRandomValues", "crypto.getRandomValues(new Uint8Array(1));"],
      ["randomUUID", "const a = randomUUID();"],
      ["fetch", "await fetch(url);"],
      ["XMLHttpRequest", "const a = new XMLHttpRequest();"],
      ["WebSocket", "const a = new WebSocket(url);"],
      ["sendBeacon", "navigator.sendBeacon(url);"],
    ];
    for (const [label, code] of cases) {
      expect(findForbiddenUses(code), label).toContain(label);
    }
  });

  it("allows Date.parse and new Date with an argument", () => {
    expect(findForbiddenUses('const a = Date.parse("2026-01-01"); const b = new Date(0);')).toEqual([]);
  });

  it("finds imports, re-exports and dynamic imports", () => {
    const records = importsOf(
      "module.ts",
      'import fs from "node:fs"; import { a as b, c } from "pkg"; import * as ns from "./x.js"; export { d } from "./y.js"; export * from "./z.js"; const m = await import("lazy");',
    );
    expect(records.map((record) => [record.specifier, ...record.names])).toEqual([
      ["node:fs", "default"],
      ["pkg", "a", "c"],
      ["./x.js", "*"],
      ["./y.js", "d"],
      ["./z.js", "*"],
      ["lazy", "*"],
    ]);
  });

  it("lists the exported names of a module", () => {
    expect([
      ...exportedNames(
        "export const A = 1; export function f() {} export type T = string; export interface I {} const hidden = 2; export { hidden as renamed };",
      ),
    ].sort()).toEqual(["A", "I", "T", "f", "renamed"]);
  });
});

describe("MapInput accepts no fact item, card or source", () => {
  const base: MapInput | undefined = GOLDEN_VECTORS.find((vector) => vector.id === "V15")?.input;

  it("rejects them as a type error and gives the same map when they are attached at run time", () => {
    expect(base).toBeDefined();
    if (base === undefined) {
      return;
    }
    // @ts-expect-error cards is not a property of MapInput
    const withCards: MapInput = { ...base, cards: [] };
    // @ts-expect-error facts is not a property of MapInput
    const withFacts: MapInput = { ...base, facts: [] };
    // @ts-expect-error sources is not a property of MapInput
    const withSources: MapInput = { ...base, sources: [] };
    // @ts-expect-error a bank has no facts
    const withBankFacts: MapInput = { ...base, bank: { ...base.bank, facts: [] } };
    const expected = generateValuesMap(base);
    for (const candidate of [withCards, withFacts, withSources, withBankFacts]) {
      expect(generateValuesMap(candidate)).toEqual(expected);
    }
  });
});