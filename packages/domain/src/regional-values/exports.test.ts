import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as bundleLoad from "./bundle/loadBundle.js";
import * as bundleLoadFailure from "./bundle/loadFailureTexts.js";
import * as bundleVerify from "./bundle/verifyBundleText.js";
import * as browser from "./browser.js";
import * as domainRoot from "../index.js";
import * as mapModule from "./map/index.js";
import * as sessionModule from "./session/index.js";
import * as viewModule from "./view/index.js";
import { repoPath } from "../../../../tests/harness/regional-values/importGraph.js";

// Feature: regional-values-map, Property 52 (公開面): ブラウザ向けの入口と既存の入口

type PackageJson = Readonly<{
  main: string;
  types: string;
  exports: Readonly<Record<string, unknown>>;
}>;

function readPackageJson(...segments: string[]): PackageJson {
  return JSON.parse(readFileSync(repoPath(...segments, "package.json"), "utf8")) as PackageJson;
}

const domainPackage = readPackageJson("packages", "domain");
const contractsPackage = readPackageJson("packages", "contracts");

describe("the existing package entries", () => {
  it("keep the value of \".\" in domain and contracts", () => {
    expect(domainPackage.exports["."]).toEqual({ types: "./dist/index.d.ts", import: "./dist/index.js" });
    expect(contractsPackage.exports["."]).toEqual({ types: "./dist/index.d.ts", import: "./dist/index.js" });
  });

  it("keep main and types", () => {
    for (const manifest of [domainPackage, contractsPackage]) {
      expect(manifest.main).toBe("./dist/index.js");
      expect(manifest.types).toBe("./dist/index.d.ts");
    }
  });
});

describe("the new browser entries", () => {
  it("add \"./regional-values\" to domain", () => {
    expect(domainPackage.exports["./regional-values"]).toEqual({
      types: "./dist/regional-values/browser.d.ts",
      import: "./dist/regional-values/browser.js",
    });
  });

  it("add \"./regional\" to contracts", () => {
    expect(contractsPackage.exports["./regional"]).toEqual({
      types: "./dist/models/regional/index.d.ts",
      import: "./dist/models/regional/index.js",
    });
  });

  it("add no other entry", () => {
    expect(Object.keys(domainPackage.exports).sort()).toEqual([".", "./regional-values"]);
    expect(Object.keys(contractsPackage.exports).sort()).toEqual([".", "./regional"]);
  });

  it("point at files that the build produces from existing sources", () => {
    expect(existsSync(repoPath("packages", "domain", "src", "regional-values", "browser.ts"))).toBe(true);
    expect(existsSync(repoPath("packages", "contracts", "src", "models", "regional", "index.ts"))).toBe(true);
  });
});

describe("the names that browser.ts publishes", () => {
  it("are those of map, session, view and the three bundle modules", () => {
    const expected = [
      ...Object.keys(mapModule),
      ...Object.keys(sessionModule),
      ...Object.keys(viewModule),
      ...Object.keys(bundleLoad),
      ...Object.keys(bundleLoadFailure),
      ...Object.keys(bundleVerify),
    ].sort();
    expect(Object.keys(browser).sort()).toEqual(expected);
  });

  it("include the functions that the screen calls", () => {
    for (const name of [
      "generateValuesMap",
      "diagnosticReducer",
      "initialDiagnosticState",
      "presentQuestion",
      "buildResultViewModel",
      "buildCardView",
      "buildAboutView",
      "loadBundle",
      "verifyBundleText",
      "LOAD_FAILURE_TEXTS",
    ]) {
      expect(Object.keys(browser), name).toContain(name);
    }
  });

  it("leave out the build-time code", () => {
    for (const name of [
      "checkQuestionTexts",
      "checkBalance",
      "inspectQuestionBank",
      "assembleBundleBody",
      "finalizeBundle",
      "calculateContentHash",
      "withoutContentHash",
      "portableCanonicalJson",
      "encodePortableCanonicalJson",
      "canonicalJson",
      "contentHash",
    ]) {
      expect(Object.keys(browser), name).not.toContain(name);
    }
  });

  it("are all still published by the domain root", () => {
    const published = new Set(Object.keys(domainRoot));
    expect(Object.keys(browser).filter((name) => !published.has(name))).toEqual([]);
  });
});
