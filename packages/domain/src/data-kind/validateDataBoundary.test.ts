import { describe, expect, it } from "vitest";

import {
  composeRealAiRun,
  validateDataBoundary,
  type DataBoundaryValidationResult,
  type ValidatedRealAiRunBoundary,
} from "./validateDataBoundary.js";

const REAL_RECORD = {
  dataKind: "REAL_AI",
  recordId: "real-record-1",
  payload: { label: "境界テスト用の非政策データ" },
} as const;

const FIXTURE_RECORD = {
  dataKind: "FIXTURE",
  recordId: "fictional-record-1",
  payload: { label: "架空の境界テストデータ" },
} as const;

function expectFailClosed(result: DataBoundaryValidationResult): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    return;
  }

  expect(result.error.fieldPaths.length).toBeGreaterThan(0);
  expect(result.error.outputs.save).toHaveLength(0);
  expect(result.error.outputs.analyze).toHaveLength(0);
  expect(result.error.outputs.index).toHaveLength(0);
  expect(result.error.outputs.display).toHaveLength(0);
}

describe("validateDataBoundary", () => {
  it.each([
    {
      dataKind: "REAL_AI",
      scope: "SCREEN",
      storagePath: "data/real/views/real-record-1.json",
      records: [REAL_RECORD],
    },
    {
      dataKind: "REAL_AI",
      scope: "RUN",
      storagePath: "data/real/runs/real-record-1.json",
      records: [REAL_RECORD],
    },
    {
      dataKind: "FIXTURE",
      scope: "SCREEN",
      storagePath: "packages/fixtures/views/fictional-record-1.json",
      records: [FIXTURE_RECORD],
    },
    {
      dataKind: "FIXTURE",
      scope: "RUN",
      storagePath: "packages/fixtures/runs/fictional-record-1.json",
      records: [FIXTURE_RECORD],
    },
  ] as const)("accepts one consistent $dataKind $scope boundary", (input) => {
    const result = validateDataBoundary(input);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.dataKind).toBe(input.dataKind);
    expect(result.value.scope).toBe(input.scope);
    expect(result.value.outputs.save).toHaveLength(1);
    expect(result.value.outputs.analyze).toHaveLength(1);
    expect(result.value.outputs.index).toHaveLength(1);
    expect(result.value.outputs.display).toHaveLength(1);
  });

  it.each([
    {
      dataKind: "REAL_AI",
      scope: "RUN",
      storagePath: "data/real/runs/missing.json",
      records: [{ recordId: "missing", payload: {} }],
    },
    {
      dataKind: "UNKNOWN",
      scope: "RUN",
      storagePath: "data/real/runs/unknown.json",
      records: [REAL_RECORD],
    },
    {
      dataKind: ["REAL_AI", "FIXTURE"],
      scope: "RUN",
      storagePath: "data/real/runs/multiple.json",
      records: [REAL_RECORD],
    },
    {
      dataKind: "REAL_AI",
      scope: "SCREEN",
      storagePath: "data/real/views/mixed.json",
      records: [REAL_RECORD, FIXTURE_RECORD],
    },
    {
      dataKind: "REAL_AI",
      scope: "RUN",
      storagePath: "packages/fixtures/runs/wrong-root.json",
      records: [REAL_RECORD],
    },
  ])("returns no operation targets for a boundary violation", (input) => {
    expectFailClosed(validateDataBoundary(input));
  });

  it("returns only fixed, value-free field paths", () => {
    const result = validateDataBoundary({
      dataKind: "REAL_AI",
      scope: "RUN",
      storagePath: "data/real/runs/unsafe-value.json",
      records: [{ ...REAL_RECORD, privateFieldName: "do-not-return" }],
    });

    expectFailClosed(result);
    if (result.ok) {
      return;
    }

    expect(result.error.fieldPaths).toEqual(["records[0]"]);
    expect(JSON.stringify(result.error)).not.toContain("do-not-return");
    expect(JSON.stringify(result.error)).not.toContain("unsafe-value");
  });

  it("composes only a validated REAL_AI run", () => {
    const realBoundary = validateDataBoundary({
      dataKind: "REAL_AI",
      scope: "RUN",
      storagePath: "data/real/runs/real-record-1.json",
      records: [REAL_RECORD],
    });
    expect(realBoundary.ok).toBe(true);
    if (
      !realBoundary.ok ||
      realBoundary.value.dataKind !== "REAL_AI" ||
      realBoundary.value.scope !== "RUN"
    ) {
      return;
    }

    const composition = composeRealAiRun(realBoundary.value);
    expect(composition.ok).toBe(true);
    if (composition.ok) {
      expect(composition.value.records).toHaveLength(1);
      expect(composition.value.dataKind).toBe("REAL_AI");
    }

    const fixtureBoundary = validateDataBoundary({
      dataKind: "FIXTURE",
      scope: "RUN",
      storagePath: "packages/fixtures/runs/fictional-record-1.json",
      records: [FIXTURE_RECORD],
    });
    expect(fixtureBoundary.ok).toBe(true);
    if (!fixtureBoundary.ok) {
      return;
    }

    const forgedRealBoundary =
      fixtureBoundary.value as unknown as ValidatedRealAiRunBoundary;
    const rejected = composeRealAiRun(forgedRealBoundary);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe("DATA_KIND_MIXED");
      expect(rejected.error.outputs.save).toHaveLength(0);
      expect(rejected.error.outputs.analyze).toHaveLength(0);
      expect(rejected.error.outputs.index).toHaveLength(0);
      expect(rejected.error.outputs.display).toHaveLength(0);
    }
  });
});
