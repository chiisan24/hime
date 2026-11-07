import { isDeepStrictEqual } from "node:util";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  createWebBuildMarker,
  parseWebBuildMarkerForTarget,
  resolveBuildTarget,
} from "./applicationMode.js";

const modeInputArbitrary: fc.Arbitrary<unknown> = fc.oneof(
  fc.jsonValue(),
  fc.bigInt(),
  fc.constant(undefined),
  fc.constant("analyst"),
);

const markerKeyNames = new Set([
  "schemaVersion",
  "applicationMode",
  "outputDirectory",
]);

// Field names that collide with Object.prototype members. A marker parser must
// reject them as unknown own fields, so they are generated on every run instead
// of relying on fc.string() to produce them by chance.
const prototypeSensitiveFieldNames = [
  "constructor",
  "__proto__",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
] as const;

const unknownMarkerFieldArbitrary = fc.tuple(
  fc.oneof(
    fc.constantFrom(...prototypeSensitiveFieldNames),
    fc
      .string({ minLength: 1 })
      .filter((fieldName) => !markerKeyNames.has(fieldName)),
  ),
  fc.jsonValue(),
);

// Non-mutation check that compares [[Prototype]], own keys, and values
// (Object.is for primitives). Vitest's toStrictEqual is not used here because
// its type check compares `actual.constructor === expected.constructor`; when a
// generated own field is named "constructor", that lookup returns the field
// value, and a structuredClone snapshot holds a different object identity.
function expectUnchanged(actual: unknown, snapshot: unknown, label: string): void {
  expect(isDeepStrictEqual(actual, snapshot), `${label} was mutated`).toBe(true);
}

const invalidSchemaVersionArbitrary: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer().filter((version) => version !== 1),
  fc.string(),
  fc.boolean(),
  fc.constant(null),
);

describe("Property 5: mode-to-build-target isolation", () => {
  // Feature: visitor-analyst-mode-separation, Property 5: mode-to-build-target isolation
  // **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
  it("maps every mode to exactly one isolated route, output, and preview target without mutating input", () => {
    fc.assert(
      fc.property(modeInputArbitrary, (mode) => {
        const originalMode = structuredClone(mode);
        const visitorTarget = resolveBuildTarget(undefined);
        const analystTarget = resolveBuildTarget("analyst");
        const target = resolveBuildTarget(mode);
        const expectedTarget = mode === "analyst" ? analystTarget : visitorTarget;
        const oppositeTarget =
          target.applicationMode === "ANALYST" ? visitorTarget : analystTarget;
        const previewTarget = target.outputDirectory;
        const matchingTargets = [visitorTarget, analystTarget].filter(
          (candidate) =>
            candidate.applicationMode === target.applicationMode &&
            candidate.routeEntry === target.routeEntry &&
            candidate.outputDirectory === target.outputDirectory,
        );

        expect(target).toEqual(expectedTarget);
        expect(matchingTargets).toHaveLength(1);
        expect(visitorTarget.outputDirectory).not.toBe(
          analystTarget.outputDirectory,
        );
        expect(previewTarget).toBe(expectedTarget.outputDirectory);
        expect(previewTarget).not.toBe(oppositeTarget.outputDirectory);
        expectUnchanged(mode, originalMode, "mode input");
      }),
      {
        numRuns: 200,
        examples: [[{ constructor: {} }], [{ ["__proto__"]: { analyst: true } }]],
      },
    );
  });

  it("strictly validates markers for only the requested preview target without mutating candidates", () => {
    fc.assert(
      fc.property(
        modeInputArbitrary,
        unknownMarkerFieldArbitrary,
        invalidSchemaVersionArbitrary,
        (mode, [unknownField, unknownValue], invalidSchemaVersion) => {
          const target = resolveBuildTarget(mode);
          const oppositeTarget = resolveBuildTarget(
            target.applicationMode === "ANALYST" ? undefined : "analyst",
          );
          const marker = createWebBuildMarker(target);
          const markerSnapshot = structuredClone(marker);
          const markerWithUnknownField = {
            ...marker,
            [unknownField]: unknownValue,
          };
          const markerWithUnknownFieldSnapshot = structuredClone(
            markerWithUnknownField,
          );
          const invalidSchemaMarker = {
            ...marker,
            schemaVersion: invalidSchemaVersion,
          };
          const mismatchedOutputMarker = {
            ...marker,
            outputDirectory: oppositeTarget.outputDirectory,
          };

          expect(parseWebBuildMarkerForTarget(marker, target)).toEqual(marker);
          expect(
            Object.keys(parseWebBuildMarkerForTarget(marker, target) ?? {}).sort(),
          ).toEqual([
            "applicationMode",
            "outputDirectory",
            "schemaVersion",
          ]);
          // The candidate must carry the unknown name as an own field (not a
          // prototype change) so the rejection below is about the unknown field.
          expect(Object.hasOwn(markerWithUnknownField, unknownField)).toBe(true);
          expect(
            parseWebBuildMarkerForTarget(markerWithUnknownField, target),
          ).toBeNull();
          expect(
            parseWebBuildMarkerForTarget(invalidSchemaMarker, target),
          ).toBeNull();
          expect(
            parseWebBuildMarkerForTarget(mismatchedOutputMarker, target),
          ).toBeNull();
          expect(
            parseWebBuildMarkerForTarget(marker, oppositeTarget),
          ).toBeNull();
          expectUnchanged(marker, markerSnapshot, "marker");
          expectUnchanged(
            markerWithUnknownField,
            markerWithUnknownFieldSnapshot,
            "marker with unknown field",
          );
        },
      ),
      {
        numRuns: 200,
        examples: [
          // Regression counterexample: own "constructor" field with an object value.
          ["analyst", ["constructor", {}], null],
          [undefined, ["__proto__", { schemaVersion: 1 }], 0],
        ],
      },
    );
  });
});
