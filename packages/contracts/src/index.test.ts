import { describe, expect, it } from "vitest";

import {
  ContractPackageHealthSchema,
  getContractPackageHealth,
} from "./index.js";

describe("contracts package entry", () => {
  it("returns a schema-valid health value", () => {
    expect(ContractPackageHealthSchema.parse(getContractPackageHealth())).toEqual({
      package: "contracts",
      status: "ok",
    });
  });

  it("rejects additional fields", () => {
    expect(() =>
      ContractPackageHealthSchema.parse({
        package: "contracts",
        status: "ok",
        unexpected: true,
      }),
    ).toThrow();
  });
});
