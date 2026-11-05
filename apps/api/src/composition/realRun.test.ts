import { readFile } from "node:fs/promises";

import type { RealAiDataRecord } from "@ehime-vote-navigator/contracts";
import {
  validateDataBoundary,
  type ValidatedFixtureRunBoundary,
  type ValidatedRealAiRunBoundary,
} from "@ehime-vote-navigator/domain";
import {
  createFixtureDataRecord,
  type FixtureDataRecord,
} from "@ehime-vote-navigator/fixtures";
import { describe, expect, it } from "vitest";

import { createRealRunComposition } from "./realRun.js";

function compileTimeFixtureExclusion(
  fixtureBoundary: ValidatedFixtureRunBoundary,
  fixtureRecord: FixtureDataRecord,
): void {
  // @ts-expect-error A FIXTURE record cannot construct a REAL_AI input record.
  const realRecord: RealAiDataRecord = fixtureRecord;
  void realRecord;

  // @ts-expect-error A FIXTURE success token must not enter real-run composition.
  createRealRunComposition(fixtureBoundary);
}
void compileTimeFixtureExclusion;

describe("REAL_AI run composition boundary", () => {
  it("rejects a runtime-forged FIXTURE success token without operation targets", () => {
    const fixtureRecord = createFixtureDataRecord({
      recordId: "fictional-composition-record",
      payload: { label: "架空のcomposition境界テスト" },
    });
    const validation = validateDataBoundary({
      dataKind: "FIXTURE",
      scope: "RUN",
      storagePath: "packages/fixtures/runs/fictional-composition-record.json",
      records: [fixtureRecord],
    });

    expect(validation.ok).toBe(true);
    if (
      !validation.ok ||
      validation.value.dataKind !== "FIXTURE" ||
      validation.value.scope !== "RUN"
    ) {
      return;
    }

    const forged =
      validation.value as unknown as ValidatedRealAiRunBoundary;
    const result = createRealRunComposition(forged);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DATA_KIND_MIXED");
      expect(result.error.outputs.save).toHaveLength(0);
      expect(result.error.outputs.analyze).toHaveLength(0);
      expect(result.error.outputs.index).toHaveLength(0);
      expect(result.error.outputs.display).toHaveLength(0);
    }
  });

  it("keeps the fixture package out of the real-run composition root", async () => {
    const source = await readFile(new URL("./realRun.ts", import.meta.url), "utf8");
    const importSpecifiers = [...source.matchAll(/from\s+["']([^"']+)["']/gu)]
      .map((match) => match[1])
      .filter((specifier): specifier is string => specifier !== undefined);

    expect(importSpecifiers).not.toContain(
      "@ehime-vote-navigator/fixtures",
    );
    expect(importSpecifiers.some((specifier) => specifier.includes("fixtures"))).toBe(
      false,
    );
  });
});
