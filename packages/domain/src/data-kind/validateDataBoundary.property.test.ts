import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  validateDataBoundary,
  type DataBoundaryValidationResult,
} from "./validateDataBoundary.js";

const SAFE_FIELD_PATH = /^(?:\$|dataKind|scope|storagePath|records(?:\[\d+\])?(?:\.(?:dataKind|payload|recordId))?)$/u;
const TOKEN_CHARACTERS = [..."abcdefghijklmnopqrstuvwxyz0123456789"] as const;

const tokenArbitrary = fc
  .array(fc.constantFrom(...TOKEN_CHARACTERS), {
    minLength: 1,
    maxLength: 24,
  })
  .map((characters) => characters.join(""));

const dataKindArbitrary = fc.constantFrom("REAL_AI", "FIXTURE" as const);
const scopeArbitrary = fc.constantFrom("SCREEN", "RUN" as const);
const mutationArbitrary = fc.constantFrom(
  "missing-boundary-tag",
  "unknown-boundary-tag",
  "multiple-boundary-tags",
  "missing-record-tag",
  "unknown-record-tag",
  "multiple-record-tags",
);

type GeneratedKind = "FIXTURE" | "REAL_AI";
type GeneratedScope = "RUN" | "SCREEN";
type Mutation = typeof mutationArbitrary extends fc.Arbitrary<infer TValue>
  ? TValue
  : never;

type RawRecord = Record<string, unknown>;
type RawBoundary = Readonly<{
  dataKind: GeneratedKind;
  records: readonly RawRecord[];
  scope: GeneratedScope;
  storagePath: string;
}>;

function storagePathFor(kind: GeneratedKind, token: string): string {
  return kind === "REAL_AI"
    ? `data/real/generated/${token}.json`
    : `packages/fixtures/generated/${token}.json`;
}

function makeRecord(kind: GeneratedKind, token: string): RawRecord {
  return {
    dataKind: kind,
    recordId: `${kind === "REAL_AI" ? "real" : "fictional"}-${token}`,
    payload: {
      label:
        kind === "REAL_AI"
          ? `boundary-test-data-${token}`
          : `fictional-boundary-test-data-${token}`,
    },
  };
}

function mutateOneField(input: RawBoundary, mutation: Mutation): unknown {
  const mutatedBoundary: Record<string, unknown> = {
    ...input,
    records: [...input.records],
  };

  switch (mutation) {
    case "missing-boundary-tag":
      delete mutatedBoundary.dataKind;
      return mutatedBoundary;
    case "unknown-boundary-tag":
      mutatedBoundary.dataKind = "UNDECLARED_KIND";
      return mutatedBoundary;
    case "multiple-boundary-tags":
      mutatedBoundary.dataKind = ["REAL_AI", "FIXTURE"];
      return mutatedBoundary;
    case "missing-record-tag": {
      const mutatedRecord = { ...input.records[0] };
      delete mutatedRecord.dataKind;
      mutatedBoundary.records = [mutatedRecord];
      return mutatedBoundary;
    }
    case "unknown-record-tag":
      mutatedBoundary.records = [
        { ...input.records[0], dataKind: "UNDECLARED_KIND" },
      ];
      return mutatedBoundary;
    case "multiple-record-tags":
      mutatedBoundary.records = [
        { ...input.records[0], dataKind: ["REAL_AI", "FIXTURE"] },
      ];
      return mutatedBoundary;
  }
}

function expectZeroSafeOutputs(result: DataBoundaryValidationResult): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    return;
  }

  expect(result.error.outputs.save).toHaveLength(0);
  expect(result.error.outputs.analyze).toHaveLength(0);
  expect(result.error.outputs.index).toHaveLength(0);
  expect(result.error.outputs.display).toHaveLength(0);
  expect(result.error.fieldPaths.length).toBeGreaterThan(0);
  expect(
    result.error.fieldPaths.every((fieldPath) =>
      SAFE_FIELD_PATH.test(fieldPath),
    ),
  ).toBe(true);
}

describe("Property 8: data kind and storage-root exclusivity", () => {
  // Feature: ehime-vote-navigator, Property 8: data kindと保存rootの排他性
  // **Validates: Requirements 4.1, 4.2, 4.4, 4.5, 4.6, 4.9, 4.10, 4.12**
  it("fails closed for every one-field tag mutation, mixed set, and root mismatch", () => {
    fc.assert(
      fc.property(
        dataKindArbitrary,
        scopeArbitrary,
        tokenArbitrary,
        mutationArbitrary,
        (dataKind, scope, token, mutation) => {
          const record = makeRecord(dataKind, token);
          const validBoundary: RawBoundary = {
            dataKind,
            scope,
            storagePath: storagePathFor(dataKind, token),
            records: [record],
          };

          const validResult = validateDataBoundary(validBoundary);
          expect(validResult.ok).toBe(true);
          if (validResult.ok) {
            expect(validResult.value.dataKind).toBe(dataKind);
            expect(validResult.value.scope).toBe(scope);
            expect(validResult.value.outputs.save).toHaveLength(1);
            expect(validResult.value.outputs.analyze).toHaveLength(1);
            expect(validResult.value.outputs.index).toHaveLength(1);
            expect(validResult.value.outputs.display).toHaveLength(1);
          }

          expectZeroSafeOutputs(
            validateDataBoundary(mutateOneField(validBoundary, mutation)),
          );

          const oppositeKind =
            dataKind === "REAL_AI" ? "FIXTURE" : "REAL_AI";
          expectZeroSafeOutputs(
            validateDataBoundary({
              ...validBoundary,
              records: [record, makeRecord(oppositeKind, `${token}-other`)],
            }),
          );

          expectZeroSafeOutputs(
            validateDataBoundary({
              ...validBoundary,
              storagePath: storagePathFor(oppositeKind, token),
            }),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
