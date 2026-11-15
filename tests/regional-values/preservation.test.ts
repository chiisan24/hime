import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { FIXED_TEXT_KEYS } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { repoPath } from "../harness/regional-values/importGraph.js";

// 12.1: the existing assets are kept (Req 10.6, 10.7, 10.8, 10.9, 10.10). What this file checks is on the
// source: the new files of the feature do not take in, or call, the old matching code, the OCR code or the
// application of the screens, and the new tests are not skipped. The changes to tracked files against the state
// before the feature are read with `git diff` and reported by the task, and are not a test here: a working tree
// in which the co-developer is changing the screens must not fail this file.

const REPOSITORY = repoPath();
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "dist-analyst", ".git", "coverage"]);

function filesBelow(directory: string): string[] {
  const found: string[] = [];
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...filesBelow(path));
    } else if (statSync(path).isFile()) {
      found.push(path);
    }
  }
  return found;
}

const posix = (path: string): string => relative(REPOSITORY, path).replaceAll("\\", "/");

/** The files of the feature: `packages/*\/src/**\/regional*`, `apps/api/src/regional-values/**`, `tests/regional-values/**` and the harness of the tests. */
function featureFiles(): string[] {
  const files = new Set<string>();
  for (const root of [["apps", "api", "src", "regional-values"], ["tests", "regional-values"], ["tests", "harness", "regional-values"]]) {
    for (const file of filesBelow(repoPath(...root))) {
      files.add(file);
    }
  }
  for (const entry of readdirSync(repoPath("packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    for (const file of filesBelow(repoPath("packages", entry.name, "src"))) {
      if (posix(file).split("/").some((segment) => segment.startsWith("regional"))) {
        files.add(file);
      }
    }
  }
  return [...files].filter((file) => /\.(ts|tsx|mjs|js)$/u.test(file)).sort();
}

const FILES = featureFiles();
const SOURCES = FILES.filter((file) => !/\.test\.tsx?$/u.test(file));
const TESTS = FILES.filter((file) => /\.test\.tsx?$/u.test(file) && !file.endsWith("preservation.test.ts"));
const TEXTS = new Map(FILES.map((file) => [file, readFileSync(file, "utf8")] as const));

const SPECIFIER = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/gu;

function specifiersOf(text: string): string[] {
  return [...text.matchAll(SPECIFIER)].map((match) => match[1] ?? match[2] ?? match[3] ?? "").filter((specifier) => specifier !== "");
}

/** Where a specifier points in the repository (as a path with `/`), when it is a path of the repository. */
function targetOf(file: string, specifier: string): string | null {
  return specifier.startsWith(".") ? posix(resolve(dirname(file), specifier)) : null;
}

const OLD_MATCHING_MODULE = /(^|\/)(matching|match|stance|stances|candidate-comparison|candidateComparison)(\/|\.|$)/u;
const OLD_MATCHING_CALL = /\b(computeMatch|calculateMatch|matchCandidates|compareCandidates|recordStance|saveStance)\s*\(/u;

function forbiddenTarget(file: string, specifier: string): string | null {
  const target = targetOf(file, specifier);
  if (specifier === "@ehime-vote-navigator/web" || specifier.startsWith("@ehime-vote-navigator/web/")) {
    return "the application of the screens";
  }
  if (target !== null) {
    if (target.startsWith("apps/web/") || target === "apps/web") {
      return "the application of the screens (apps/web)";
    }
    if (target.startsWith("apps/api/src/ocr/") || target === "apps/api/src/ocr") {
      return "the OCR modules (apps/api/src/ocr)";
    }
    if (OLD_MATCHING_MODULE.test(target)) {
      return "a module of the old matching function";
    }
  } else if (/(^|\/)apps\/web(\/|$)/u.test(specifier) || /(^|\/)ocr(\/|$)/u.test(specifier) || OLD_MATCHING_MODULE.test(specifier)) {
    return "a path of the screens, the OCR or the old matching function";
  }
  return null;
}

describe("the new files of the feature (Req 10.6, 10.7, 10.9)", () => {
  it("has files to check in the three places of the feature", () => {
    const names = FILES.map(posix);
    expect(names.some((name) => name.startsWith("apps/api/src/regional-values/"))).toBe(true);
    expect(names.some((name) => name.startsWith("tests/regional-values/"))).toBe(true);
    expect(names.some((name) => name.startsWith("packages/domain/src/regional-values/"))).toBe(true);
    expect(names.some((name) => name.startsWith("packages/contracts/src/models/regional/"))).toBe(true);
    expect(FILES.length).toBeGreaterThan(200);
    expect(SOURCES.length).toBeGreaterThan(80);
    expect(TESTS.length).toBeGreaterThan(80);
  });

  it("take in no module of the application of the screens, of the OCR, or of the old matching function", () => {
    const found: string[] = [];
    for (const file of FILES) {
      for (const specifier of specifiersOf(TEXTS.get(file) ?? "")) {
        const reason = forbiddenTarget(file, specifier);
        if (reason !== null) {
          found.push(`${posix(file)} takes in ${specifier} (${reason})`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("call no function of the old matching function", () => {
    const found = SOURCES.concat(TESTS).filter((file) => OLD_MATCHING_CALL.test(TEXTS.get(file) ?? "")).map(posix);
    expect(found).toEqual([]);
  });

  it("find a forbidden target where there is one: the check is not empty", () => {
    const probe = repoPath("apps", "api", "src", "regional-values", "main.ts");
    expect(forbiddenTarget(probe, "../../../../apps/web/src/app/routes.js")).toBe("the application of the screens (apps/web)");
    expect(forbiddenTarget(probe, "../ocr/trace.js")).toBe("the OCR modules (apps/api/src/ocr)");
    expect(forbiddenTarget(probe, "./ocr/trace.js")).toBeNull();
    expect(forbiddenTarget(probe, "../matching/score.js")).toBe("a module of the old matching function");
    expect(forbiddenTarget(probe, "../content/quoteMatch.js")).toBeNull();
    expect(forbiddenTarget(probe, "@ehime-vote-navigator/web")).toBe("the application of the screens");
    expect(specifiersOf('import type { A } from "./a.js";\nexport * from "./b.js";\nconst c = await import("./c.js");')).toEqual(["./a.js", "./b.js", "./c.js"]);
    expect(specifiersOf('import {\n  A,\n  B,\n} from "../x/y.js";')).toEqual(["../x/y.js"]);
  });

  it("have no test that is skipped, left as a todo, or the only one that runs", () => {
    const pattern = /\b(?:it|test|describe|suite)\s*\.\s*(?:skip|todo|only|skipIf|runIf|fails|concurrent\s*\.\s*skip)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(/u;
    const found = TESTS.filter((file) => pattern.test(TEXTS.get(file) ?? "")).map(posix);
    expect(found).toEqual([]);
  });
});

describe("the texts that the screens show (Req 10.6)", () => {
  const BANNED = ["一致度", "一致率", "立場記録", "候補者比較", "候補者の比較"];

  it("have no key of a fixed text for a match, a stance record or a comparison of candidates", () => {
    expect(FIXED_TEXT_KEYS.length).toBeGreaterThan(100);
    expect(FIXED_TEXT_KEYS.filter((key) => /match|stance|candidate|compar|rank|score|rating/iu.test(key))).toEqual([]);
  });

  it("have none of the words of a match, a stance record or a comparison of candidates in the fictional data that the bundle is made of", () => {
    const directory = repoPath("packages", "fixtures", "src", "regional-values");
    for (const name of ["fixed-texts.json", "result-texts.json", "guidance.json", "question-bank.json", "cards.json"]) {
      const text = readFileSync(join(directory, name), "utf8");
      for (const word of BANNED) {
        expect(text, `${name}: ${word}`).not.toContain(word);
      }
    }
  });
});
