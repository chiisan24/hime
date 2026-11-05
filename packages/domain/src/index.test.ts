import { describe, expect, it } from "vitest";

import { getDomainPackageHealth } from "./index.js";
import type { Result } from "./index.js";

describe("domain package entry", () => {
  it("reports that the package can be loaded", () => {
    expect(getDomainPackageHealth()).toEqual({
      package: "domain",
      status: "ok",
    });
  });

  it("narrows a generic Result by its ok discriminant", () => {
    function readResult(result: Result<number, string>): number {
      return result.ok ? result.value : result.error.length;
    }

    expect(readResult({ ok: true, value: 42 })).toBe(42);
    expect(readResult({ ok: false, error: "error" })).toBe(5);
  });
});
