import { describe, expect, it } from "vitest";

import {
  FixtureDataBoundaryInputSchema,
  FixtureDataRecordSchema,
  FixtureRunBoundaryInputSchema,
  RealAiDataBoundaryInputSchema,
  RealAiDataRecordSchema,
  RealAiRunBoundaryInputSchema,
} from "./data-kind.js";

const REAL_RECORD = {
  dataKind: "REAL_AI",
  recordId: "real-boundary-example",
  payload: { label: "境界検証用の非政策データ" },
} as const;

const FIXTURE_RECORD = {
  dataKind: "FIXTURE",
  recordId: "fictional-boundary-example",
  payload: { label: "架空の境界テストデータ" },
} as const;

describe("data-kind contracts", () => {
  it("decodes REAL_AI and FIXTURE records with separate strict schemas", () => {
    const realRecord = RealAiDataRecordSchema.parse(REAL_RECORD);
    const fixtureRecord = FixtureDataRecordSchema.parse(FIXTURE_RECORD);

    expect(realRecord.dataKind).toBe("REAL_AI");
    expect(fixtureRecord.dataKind).toBe("FIXTURE");
    expect(Object.isFrozen(realRecord)).toBe(true);
    expect(Object.isFrozen(fixtureRecord)).toBe(true);

    expect(RealAiDataRecordSchema.safeParse(FIXTURE_RECORD).success).toBe(false);
    expect(FixtureDataRecordSchema.safeParse(REAL_RECORD).success).toBe(false);
  });

  it.each([
    { recordId: "missing-tag", payload: {} },
    { dataKind: "UNKNOWN", recordId: "unknown-tag", payload: {} },
    {
      dataKind: ["REAL_AI", "FIXTURE"],
      recordId: "multiple-tags",
      payload: {},
    },
    { ...REAL_RECORD, fixtureTag: "FIXTURE" },
  ])("rejects missing, unknown, multiple, or additional tags", (record) => {
    expect(RealAiDataRecordSchema.safeParse(record).success).toBe(false);
    expect(FixtureDataRecordSchema.safeParse(record).success).toBe(false);
  });

  it("requires the matching storage root and record kind for each run", () => {
    const realRun = {
      dataKind: "REAL_AI",
      scope: "RUN",
      storagePath: "data/real/runs/real-boundary-example.json",
      records: [REAL_RECORD],
    };
    const fixtureRun = {
      dataKind: "FIXTURE",
      scope: "RUN",
      storagePath: "packages/fixtures/runs/fictional-boundary-example.json",
      records: [FIXTURE_RECORD],
    };

    expect(RealAiRunBoundaryInputSchema.safeParse(realRun).success).toBe(true);
    expect(FixtureRunBoundaryInputSchema.safeParse(fixtureRun).success).toBe(true);
    expect(RealAiDataBoundaryInputSchema.safeParse(realRun).success).toBe(true);
    expect(FixtureDataBoundaryInputSchema.safeParse(fixtureRun).success).toBe(
      true,
    );

    expect(
      RealAiRunBoundaryInputSchema.safeParse({
        ...realRun,
        storagePath: fixtureRun.storagePath,
      }).success,
    ).toBe(false);
    expect(
      FixtureRunBoundaryInputSchema.safeParse({
        ...fixtureRun,
        records: [REAL_RECORD],
      }).success,
    ).toBe(false);
  });

  it.each([
    "data/real",
    "data/real/../packages/fixtures/example.json",
    "/data/real/example.json",
    "C:\\data\\real\\example.json",
  ])("rejects unsafe or non-descendant storage path %s", (storagePath) => {
    expect(
      RealAiRunBoundaryInputSchema.safeParse({
        dataKind: "REAL_AI",
        scope: "RUN",
        storagePath,
        records: [REAL_RECORD],
      }).success,
    ).toBe(false);
  });
});
