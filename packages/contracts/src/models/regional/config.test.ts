import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";

import * as contracts from "../../index.js";
import { MapConfigSchema } from "./config.js";
import type { MapConfig } from "./config.js";

type Json = Record<string, unknown>;

function mapConfig(overrides: Json = {}): Json {
  return { thresholds: { t1: 50, t2: 150 }, guidanceMaxThemes: 3, ...overrides };
}

function withThresholds(t1: unknown, t2: unknown): Json {
  return mapConfig({ thresholds: { t1, t2 } });
}

/** Parses, requires a rejection, and returns the dotted paths of the issues. */
function rejectedPaths(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("MapConfigSchema: accepted values", () => {
  it("accepts the initial values (T1 50, T2 150, 3 guidance themes)", () => {
    const result = MapConfigSchema.safeParse(mapConfig());
    expect(result.success).toBe(true);
    expect(result.success ? result.data : null).toEqual({
      thresholds: { t1: 50, t2: 150 },
      guidanceMaxThemes: 3,
    });
  });

  it.each([
    ["the smallest T1", 1, 150, 3],
    ["the largest T2", 50, 200, 3],
    ["the closest pair at the upper end", 199, 200, 3],
    ["the closest pair at the lower end", 1, 2, 3],
    ["one guidance theme", 50, 150, 1],
    ["more guidance themes than there are themes", 50, 150, 100],
  ])("accepts %s", (_name, t1, t2, guidanceMaxThemes) => {
    expect(
      MapConfigSchema.safeParse(mapConfig({ thresholds: { t1, t2 }, guidanceMaxThemes })).success,
    ).toBe(true);
  });

  it("derives the type from the schema", () => {
    expectTypeOf<MapConfig>().toEqualTypeOf<{
      thresholds: { t1: number; t2: number };
      guidanceMaxThemes: number;
    }>();
  });

  it("is exported from the contracts barrel", () => {
    expect(contracts.MapConfigSchema).toBe(MapConfigSchema);
  });
});

describe("MapConfigSchema: thresholds", () => {
  it.each([
    ["T1 = 0", 0, 150],
    ["T1 = -1", -1, 150],
    ["T1 = T2", 50, 50],
    ["T1 > T2", 150, 50],
    ["T1 = T2 = 200", 200, 200],
    ["T2 = 201", 50, 201],
    ["T2 = 0", 50, 0],
    ["a fractional T1 (50.5)", 50.5, 150],
    ["a fractional T1 below 1 (0.5)", 0.5, 150],
    ["a fractional T2 (150.5)", 50, 150.5],
    ["a string T1 (\"50\")", "50", 150],
    ["a string T2 (\"150\")", 50, "150"],
    ["a NaN T1", Number.NaN, 150],
    ["a NaN T2", 50, Number.NaN],
    ["an infinite T2", 50, Number.POSITIVE_INFINITY],
    ["a null T1", null, 150],
    ["a boolean T2", 50, true],
  ])("rejects %s", (_name, t1, t2) => {
    expect(MapConfigSchema.safeParse(withThresholds(t1, t2)).success).toBe(false);
  });

  it("reports T1 = 0 on t1, T2 = 201 on t2, and a bad order on t2", () => {
    expect(rejectedPaths(MapConfigSchema, withThresholds(0, 150))).toEqual(["thresholds.t1"]);
    expect(rejectedPaths(MapConfigSchema, withThresholds(50, 201))).toEqual(["thresholds.t2"]);
    expect(rejectedPaths(MapConfigSchema, withThresholds(50, 50))).toEqual(["thresholds.t2"]);
    expect(rejectedPaths(MapConfigSchema, withThresholds(150, 50))).toEqual(["thresholds.t2"]);
  });

  it("rejects an extra key and a missing key inside thresholds", () => {
    expect(
      MapConfigSchema.safeParse(mapConfig({ thresholds: { t1: 50, t2: 150, t3: 200 } })).success,
    ).toBe(false);
    expect(MapConfigSchema.safeParse(mapConfig({ thresholds: { t1: 50 } })).success).toBe(false);
    expect(MapConfigSchema.safeParse(mapConfig({ thresholds: { t2: 150 } })).success).toBe(false);
    expect(MapConfigSchema.safeParse(mapConfig({ thresholds: {} })).success).toBe(false);
  });

  it.each([
    ["null", null],
    ["an array", [50, 150]],
    ["a string", "50,150"],
  ])("rejects thresholds that are %s", (_name, thresholds) => {
    expect(MapConfigSchema.safeParse(mapConfig({ thresholds })).success).toBe(false);
  });
});

describe("MapConfigSchema: guidanceMaxThemes", () => {
  it.each([
    ["0", 0],
    ["-1", -1],
    ["a fraction (1.5)", 1.5],
    ["a string (\"3\")", "3"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["null", null],
  ])("rejects %s", (_name, guidanceMaxThemes) => {
    expect(rejectedPaths(MapConfigSchema, mapConfig({ guidanceMaxThemes }))).toEqual([
      "guidanceMaxThemes",
    ]);
  });
});

describe("MapConfigSchema: structure", () => {
  it("rejects an extra top-level key", () => {
    expect(MapConfigSchema.safeParse(mapConfig({ unexpected: true })).success).toBe(false);
    expect(MapConfigSchema.safeParse(mapConfig({ schemaVersion: 1 })).success).toBe(false);
  });

  it("rejects a missing key", () => {
    expect(MapConfigSchema.safeParse({ guidanceMaxThemes: 3 }).success).toBe(false);
    expect(MapConfigSchema.safeParse({ thresholds: { t1: 50, t2: 150 } }).success).toBe(false);
    expect(MapConfigSchema.safeParse({}).success).toBe(false);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["an array holding a valid config", [mapConfig()]],
    ["a string", "{}"],
    ["a number", 50],
    ["undefined", undefined],
  ])("rejects a value that is %s", (_name, value) => {
    expect(MapConfigSchema.safeParse(value).success).toBe(false);
  });
});
