import { describe, expect, it } from "vitest";

import {
  createFixtureDataRecord,
  getFixturePackageHealth,
} from "./index.js";

describe("fixtures package entry", () => {
  it("marks the package as fictional-only", () => {
    expect(getFixturePackageHealth()).toEqual({
      package: "fixtures",
      status: "ok",
      fictionalOnly: true,
    });
  });

  it("creates only a FIXTURE-tagged strict record", () => {
    expect(
      createFixtureDataRecord({
        recordId: "fictional-record-1",
        payload: { label: "架空のテスト用データ" },
      }),
    ).toEqual({
      dataKind: "FIXTURE",
      recordId: "fictional-record-1",
      payload: { label: "架空のテスト用データ" },
    });

    expect(() =>
      createFixtureDataRecord({ recordId: " ", payload: {} }),
    ).toThrow();
  });
});
