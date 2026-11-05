import { describe, expect, it } from "vitest";

import {
  FixtureProviderRequestSchema,
  FixtureProviderResultSchema,
  ProviderRequestSchema,
  RealAiProviderRequestSchema,
  RealAiProviderResultSchema,
} from "./screen-data.js";

const REQUEST_BASE = {
  requestId: "screen-request-1",
  route: "/fictional-screen",
  operation: "load",
  parameters: [{ name: "filter", value: "fictional-value" }],
} as const;

const RESULT_BASE = {
  requestId: REQUEST_BASE.requestId,
  route: REQUEST_BASE.route,
  operations: [
    {
      operationId: "retry",
      label: "再試行",
      route: REQUEST_BASE.route,
    },
  ],
} as const;

function resultFor(
  dataKind: "FIXTURE" | "REAL_AI",
  status: "failure" | "no-data" | "no-results" | "success",
): unknown {
  const items =
    status === "success"
      ? [
          {
            dataKind,
            itemId: "fictional-item-1",
            fields: [{ name: "heading", value: "架空の表示値" }],
          },
        ]
      : [];

  if (status === "failure") {
    return {
      dataKind,
      status,
      ...RESULT_BASE,
      items,
      error: {
        code: "INTERNAL_FAILURE",
        message: "テスト用の取得失敗",
        fields: ["route"],
        retry: { allowed: false, remaining: 0 },
      },
    };
  }

  if (status === "no-data" || status === "no-results") {
    return {
      dataKind,
      status,
      ...RESULT_BASE,
      items,
      message: "テスト用の該当データなし",
    };
  }

  return { dataKind, status, ...RESULT_BASE, items };
}

describe("screen data provider contracts", () => {
  it("keeps REAL_AI and FIXTURE request entrances separate and strict", () => {
    const realRequest = { dataKind: "REAL_AI", ...REQUEST_BASE };
    const fixtureRequest = { dataKind: "FIXTURE", ...REQUEST_BASE };

    expect(RealAiProviderRequestSchema.safeParse(realRequest).success).toBe(
      true,
    );
    expect(FixtureProviderRequestSchema.safeParse(fixtureRequest).success).toBe(
      true,
    );
    expect(ProviderRequestSchema.safeParse(realRequest).success).toBe(true);
    expect(ProviderRequestSchema.safeParse(fixtureRequest).success).toBe(true);
    expect(RealAiProviderRequestSchema.safeParse(fixtureRequest).success).toBe(
      false,
    );
    expect(
      FixtureProviderRequestSchema.safeParse({
        ...fixtureRequest,
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it.each(["success", "no-data", "no-results", "failure"] as const)(
    "decodes the %s result through separate discriminated unions",
    (status) => {
      const realResult = resultFor("REAL_AI", status);
      const fixtureResult = resultFor("FIXTURE", status);

      expect(RealAiProviderResultSchema.safeParse(realResult).success).toBe(
        true,
      );
      expect(FixtureProviderResultSchema.safeParse(fixtureResult).success).toBe(
        true,
      );
      expect(RealAiProviderResultSchema.safeParse(fixtureResult).success).toBe(
        false,
      );
      expect(FixtureProviderResultSchema.safeParse(realResult).success).toBe(
        false,
      );
    },
  );

  it("rejects unknown fields and mixed item data kinds", () => {
    const fixtureSuccess = resultFor("FIXTURE", "success") as {
      items: readonly unknown[];
    };

    expect(
      FixtureProviderResultSchema.safeParse({
        ...(fixtureSuccess as object),
        unknownField: "must fail",
      }).success,
    ).toBe(false);
    expect(
      FixtureProviderResultSchema.safeParse({
        ...(fixtureSuccess as object),
        items: [
          {
            dataKind: "REAL_AI",
            itemId: "mixed-item",
            fields: [{ name: "heading", value: "混在" }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("does not reinterpret empty success as no-data or accept payloads on empty states", () => {
    expect(
      RealAiProviderResultSchema.safeParse(
        resultFor("REAL_AI", "success") instanceof Object
          ? { ...(resultFor("REAL_AI", "success") as object), items: [] }
          : undefined,
      ).success,
    ).toBe(false);

    expect(
      FixtureProviderResultSchema.safeParse({
        ...(resultFor("FIXTURE", "no-results") as object),
        items: [
          {
            dataKind: "FIXTURE",
            itemId: "unexpected-item",
            fields: [{ name: "heading", value: "表示不可" }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
