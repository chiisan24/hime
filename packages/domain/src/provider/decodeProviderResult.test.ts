import { describe, expect, it } from "vitest";

import {
  decodeFixtureProviderResult,
  decodeProviderResult,
  decodeRealAiProviderResult,
  type ScreenDataModel,
} from "./decodeProviderResult.js";

const BASE_RESULT = {
  requestId: "provider-unit-request",
  route: "/fictional-unit-screen",
  operations: [
    {
      operationId: "retry",
      label: "再試行",
      route: "/fictional-unit-screen",
    },
  ],
} as const;

function successResult(dataKind: "FIXTURE" | "REAL_AI"): unknown {
  return {
    dataKind,
    status: "success",
    ...BASE_RESULT,
    items: [
      {
        dataKind,
        itemId: "fictional-unit-item",
        fields: [
          { name: "title", value: "架空の画面項目" },
          { name: "enabled", value: true },
        ],
      },
    ],
  };
}

function withoutDataLabel(
  model: ScreenDataModel,
): Omit<ScreenDataModel, "dataLabel"> {
  return {
    requestId: model.requestId,
    route: model.route,
    state: model.state,
    items: model.items,
    operations: model.operations,
    message: model.message,
    failure: model.failure,
  };
}

describe("decodeProviderResult", () => {
  it("projects equivalent REAL_AI and FIXTURE success results to one screen shape", () => {
    const real = decodeRealAiProviderResult(successResult("REAL_AI"));
    const fixture = decodeFixtureProviderResult(successResult("FIXTURE"));

    expect(real.ok).toBe(true);
    expect(fixture.ok).toBe(true);
    if (!real.ok || !fixture.ok) {
      return;
    }

    expect(real.value.dataLabel).toBe("2022年実資料・AI解析");
    expect(fixture.value.dataLabel).toBe("架空fixture・UIテスト専用");
    expect(withoutDataLabel(real.value)).toEqual(withoutDataLabel(fixture.value));
    expect(real.value.items[0]).toEqual({
      itemId: "fictional-unit-item",
      fields: [
        { name: "title", value: "架空の画面項目" },
        { name: "enabled", value: true },
      ],
    });
  });

  it.each([
    ["no-data", "表示データを取得できません"],
    ["no-results", "条件に一致する結果がありません"],
  ] as const)("projects %s without inventing items", (status, message) => {
    const decoded = decodeProviderResult({
      dataKind: "FIXTURE",
      status,
      ...BASE_RESULT,
      items: [],
      message,
    });

    expect(decoded).toMatchObject({
      ok: true,
      value: {
        state: status,
        message,
        items: [],
        failure: null,
      },
    });
  });

  it("projects a strict failure detail without displaying result items", () => {
    const decoded = decodeProviderResult({
      dataKind: "REAL_AI",
      status: "failure",
      ...BASE_RESULT,
      items: [],
      error: {
        code: "INTERNAL_FAILURE",
        message: "安全な失敗案内",
        fields: ["route"],
        retry: { allowed: false, remaining: 0 },
      },
    });

    expect(decoded).toMatchObject({
      ok: true,
      value: {
        state: "failure",
        message: "安全な失敗案内",
        items: [],
        failure: {
          code: "INTERNAL_FAILURE",
          fields: ["route"],
          retry: { allowed: false, remaining: 0 },
        },
      },
    });
  });

  it.each([
    [{ ...successResult("REAL_AI") as object, extra: true }, ["$"]],
    [{ ...successResult("REAL_AI") as object, dataKind: undefined }, ["dataKind"]],
    [
      {
        ...successResult("REAL_AI") as object,
        items: [
          {
            dataKind: "FIXTURE",
            itemId: "mixed-item",
            fields: [{ name: "title", value: "混在" }],
          },
        ],
      },
      ["items[0].dataKind"],
    ],
  ] as const)("fails closed for invalid payload %#", (payload, expectedPaths) => {
    const decoded = decodeProviderResult(payload);

    expect(decoded.ok).toBe(false);
    if (decoded.ok) {
      return;
    }

    expect(decoded.error.code).toBe("PROVIDER_CONTRACT_VIOLATION");
    expect(decoded.error.state).toBe("no-data");
    expect(decoded.error.fieldPaths).toEqual(expectedPaths);
    expect(decoded.error.outputs.display).toHaveLength(0);
    expect(decoded.error.outputs.save).toHaveLength(0);
  });
});
