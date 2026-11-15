import { DatasetRecordSchema, RealSourceSchema } from "@ehime-vote-navigator/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { FICTIONAL_CATALOG, createIntakeWorld, failRenameTo, intakeRequest } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import type { IntakeWorld } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import { datasetKeyOf } from "./datasetLedger.js";
import { intakeCsv } from "./intake.js";
import { recordDatasetReview, recordSourceReview } from "./sourceReview.js";
import type { DatasetNoteReviewInput, SourceReviewUpdate, UsageReviewInput } from "./sourceReview.js";

// A review is what a person decided. The functions write what they are given, and nothing else.

const CLOCK = (): Date => new Date("2026-11-13T00:00:00Z");
const TARGET = { sourceId: "fictional-shelters", revision: "r1" } as const;
const KEY = datasetKeyOf(FICTIONAL_CATALOG);

let world: IntakeWorld | undefined;

afterEach(async () => {
  await world?.remove();
  world = undefined;
});

async function worldWithSource(withLedger = false): Promise<IntakeWorld> {
  world = await createIntakeWorld();
  const result = await intakeCsv(
    world.store,
    intakeRequest(
      withLedger
        ? { dataset: { title: "架空の避難所一覧", sourceUrl: "https://example.org/dataset/shelters", surveyDate: "2026-07-27", updatedOn: null, coverageArea: "架空県", themeIds: ["TRANSPORT"] } }
        : {},
    ),
    CLOCK,
  );
  expect(result.ok).toBe(true);
  return world;
}

const USAGE: UsageReviewInput = { status: "CONFIRMED", checkedAt: "2026-11-05", checkedTarget: "利用条件のページ", evidence: "利用可と書かれている" };
const NOTE: DatasetNoteReviewInput = { hasSpecificNote: true, noteSummary: "再配布の条件が個別に書かれている", checkedBy: "analyst-1", checkedAt: "2026-11-05T01:00:00Z" };

function sourceFile(current: IntakeWorld): string {
  return current.recordPath("sources/fictional-shelters/r1.json");
}

function datasetFile(current: IntakeWorld): string {
  return current.recordPath(`datasets/${KEY}.json`);
}

describe("recordSourceReview", () => {
  it("writes the terms of use that a person gives, as they are, and changes nothing else in the record", async () => {
    const current = await worldWithSource();
    const before = RealSourceSchema.parse(await current.readJson(sourceFile(current)));
    expect(before.usage.status).toBe("UNKNOWN");
    const result = await recordSourceReview(current.store, TARGET, { usage: USAGE });
    expect(result.ok).toBe(true);
    const after = RealSourceSchema.parse(await current.readJson(sourceFile(current)));
    expect(after).toEqual({ ...before, usage: USAGE });
    expect(result.ok && result.value).toEqual(after);
    // What was not given is not decided for the person.
    expect(after.transmission).toEqual({ status: "UNKNOWN" });
    expect(after.datasetNote).toBeNull();
  });

  it("writes the three reviews at once", async () => {
    const current = await worldWithSource();
    const transmission = { status: "ALLOWED", checkedBy: "analyst-1", checkedAt: "2026-11-05T02:00:00Z", evidence: "外部への送信を許す条項がある" } as const;
    const result = await recordSourceReview(current.store, TARGET, { usage: USAGE, datasetNote: NOTE, transmission });
    expect(result.ok && result.value).toMatchObject({ usage: USAGE, datasetNote: NOTE, transmission });
  });

  it("writes a refusal of sending as a decision of the person, not as a missing one", async () => {
    const current = await worldWithSource();
    const transmission = { status: "DENIED", checkedBy: "analyst-1", checkedAt: "2026-11-05T02:00:00Z", evidence: "外部への送信を禁じている" } as const;
    const result = await recordSourceReview(current.store, TARGET, { transmission });
    expect(result.ok && result.value.transmission).toEqual(transmission);
    expect(result.ok && result.value.usage.status).toBe("UNKNOWN");
  });

  it("writes a check that found no note of the data set, and takes it back to not checked with null", async () => {
    const current = await worldWithSource();
    const none: DatasetNoteReviewInput = { hasSpecificNote: false, checkedBy: "analyst-1", checkedAt: "2026-11-05T01:00:00Z" };
    expect((await recordSourceReview(current.store, TARGET, { datasetNote: none })).ok).toBe(true);
    expect(RealSourceSchema.parse(await current.readJson(sourceFile(current))).datasetNote).toEqual(none);
    expect((await recordSourceReview(current.store, TARGET, { datasetNote: null })).ok).toBe(true);
    expect(RealSourceSchema.parse(await current.readJson(sourceFile(current))).datasetNote).toBeNull();
  });

  it("can write that the terms of use are restricted or still unknown, as a person's record", async () => {
    const current = await worldWithSource();
    for (const status of ["RESTRICTED", "UNKNOWN"] as const) {
      const result = await recordSourceReview(current.store, TARGET, { usage: { ...USAGE, status } });
      expect(result.ok && result.value.usage.status).toBe(status);
    }
  });

  it.each([
    ["no review", {}],
    ["reviews that are undefined", { usage: undefined, datasetNote: undefined, transmission: undefined }],
  ] satisfies readonly (readonly [string, SourceReviewUpdate])[])("refuses a call with %s, and writes nothing", async (_name, update) => {
    const current = await worldWithSource();
    const before = await current.readText(sourceFile(current));
    expect(await recordSourceReview(current.store, TARGET, update)).toEqual({ ok: false, error: { code: "REVIEW_EMPTY" } });
    expect(await current.readText(sourceFile(current))).toBe(before);
  });

  it.each([
    ["terms of use without an evidence", { usage: { ...USAGE, evidence: "" } }, ["usage"]],
    ["terms of use with a date that does not exist", { usage: { ...USAGE, checkedAt: "2026-02-30" } }, ["usage"]],
    ["terms of use of a status that is not one", { usage: { ...USAGE, status: "OK" as unknown as "CONFIRMED" } }, ["usage"]],
    ["terms of use with an item that the contract does not have", { usage: { ...USAGE, approvedBy: "x" } as unknown as UsageReviewInput }, ["usage"]],
    ["a note of the data set that is said to exist and has no summary", { datasetNote: { hasSpecificNote: true, checkedBy: "analyst-1", checkedAt: "2026-11-05T01:00:00Z" } }, ["datasetNote"]],
    ["a note of the data set without the person who checked", { datasetNote: { hasSpecificNote: false, checkedAt: "2026-11-05T01:00:00Z" } as unknown as DatasetNoteReviewInput }, ["datasetNote"]],
    ["a permission to send without the person who checked", { transmission: { status: "ALLOWED", checkedAt: "2026-11-05T01:00:00Z", evidence: "x" } as unknown as SourceReviewUpdate["transmission"] }, ["transmission"]],
    ["a permission to send without an evidence", { transmission: { status: "ALLOWED", checkedBy: "analyst-1", checkedAt: "2026-11-05T01:00:00Z", evidence: " " } }, ["transmission"]],
  ] satisfies readonly (readonly [string, SourceReviewUpdate, readonly string[]])[])("refuses %s, names the item, and writes nothing", async (_name, update, fields) => {
    const current = await worldWithSource();
    const before = await current.readText(sourceFile(current));
    expect(await recordSourceReview(current.store, TARGET, update)).toEqual({ ok: false, error: { code: "REVIEW_INVALID", fields } });
    expect(await current.readText(sourceFile(current))).toBe(before);
  });

  it("refuses an adoption: a source has none", async () => {
    const current = await worldWithSource();
    const update = { adoption: { status: "ADOPTED", decidedBy: "owner-1", decidedAt: "2026-11-06T00:00:00Z", reason: "x" } } as unknown as SourceReviewUpdate;
    expect(await recordSourceReview(current.store, TARGET, update)).toEqual({ ok: false, error: { code: "REVIEW_INVALID", fields: ["adoption"] } });
  });

  it.each([
    ["a source that has no record", { sourceId: "no-such-source", revision: "r1" }],
    ["a revision that has no record", { sourceId: "fictional-shelters", revision: "r2" }],
  ])("refuses %s", async (_name, target) => {
    const current = await worldWithSource();
    expect(await recordSourceReview(current.store, target, { usage: USAGE })).toEqual({ ok: false, error: { code: "RECORD_NOT_FOUND" } });
  });

  it("leaves the record as it was when the file cannot be replaced", async () => {
    const current = await worldWithSource();
    const before = await current.readText(sourceFile(current));
    const store = current.storeWith(failRenameTo((finalPath) => finalPath.endsWith(".json")));
    expect(await recordSourceReview(store, TARGET, { usage: USAGE })).toEqual({ ok: false, error: { code: "STORE_WRITE_FAILED" } });
    expect(await current.readText(sourceFile(current))).toBe(before);
    expect((await current.files()).filter((path) => path.endsWith(".tmp"))).toEqual([]);
  });

  it("changes only the revision that it is told to change", async () => {
    const current = await worldWithSource();
    await intakeCsv(current.store, intakeRequest({ bytes: new TextEncoder().encode("名称,件数\nあおば,99\n") }), CLOCK);
    const second = await current.readText(current.recordPath("sources/fictional-shelters/r2.json"));
    await recordSourceReview(current.store, TARGET, { usage: USAGE });
    expect(await current.readText(current.recordPath("sources/fictional-shelters/r2.json"))).toBe(second);
  });
});

describe("recordDatasetReview", () => {
  it("writes the reviews and the adoption that a person gives, and the adoption is a decision with the person and the reason", async () => {
    const current = await worldWithSource(true);
    const before = DatasetRecordSchema.parse(await current.readJson(datasetFile(current)));
    expect(before.adoption).toEqual({ status: "CANDIDATE" });
    const adoption = { status: "ADOPTED", decidedBy: "owner-1", decidedAt: "2026-11-06T00:00:00Z", reason: "架空の理由" } as const;
    const result = await recordDatasetReview(current.store, KEY, { usage: USAGE, datasetNote: { ...NOTE, hasSpecificNote: false }, adoption });
    expect(result.ok).toBe(true);
    const after = DatasetRecordSchema.parse(await current.readJson(datasetFile(current)));
    expect(after).toEqual({ ...before, usage: USAGE, datasetNote: { ...NOTE, hasSpecificNote: false }, adoption });
    expect(result.ok && result.value).toEqual(after);
  });

  it("refuses an adoption while the terms of use are not confirmed or the note is not checked, and names them", async () => {
    const current = await worldWithSource(true);
    const before = await current.readText(datasetFile(current));
    const adoption = { status: "ADOPTED", decidedBy: "owner-1", decidedAt: "2026-11-06T00:00:00Z", reason: "架空の理由" } as const;
    expect(await recordDatasetReview(current.store, KEY, { adoption })).toEqual({ ok: false, error: { code: "REVIEW_INVALID", fields: ["usage", "datasetNote"] } });
    expect(await recordDatasetReview(current.store, KEY, { adoption, usage: USAGE })).toEqual({ ok: false, error: { code: "REVIEW_INVALID", fields: ["datasetNote"] } });
    expect(await current.readText(datasetFile(current))).toBe(before);
  });

  it("writes a rejection, which needs no condition, and a return to a candidate", async () => {
    const current = await worldWithSource(true);
    const rejected = { status: "REJECTED", decidedBy: "owner-1", decidedAt: "2026-11-06T00:00:00Z", reason: "利用条件が合わない" } as const;
    expect((await recordDatasetReview(current.store, KEY, { adoption: rejected })).ok).toBe(true);
    expect(DatasetRecordSchema.parse(await current.readJson(datasetFile(current))).adoption).toEqual(rejected);
    expect((await recordDatasetReview(current.store, KEY, { adoption: { status: "CANDIDATE" } })).ok).toBe(true);
    expect(DatasetRecordSchema.parse(await current.readJson(datasetFile(current))).adoption).toEqual({ status: "CANDIDATE" });
  });

  it("refuses a decision without the person or the reason", async () => {
    const current = await worldWithSource(true);
    const noReason = { adoption: { status: "REJECTED", decidedBy: "owner-1", decidedAt: "2026-11-06T00:00:00Z", reason: "" } } as const;
    expect(await recordDatasetReview(current.store, KEY, noReason)).toEqual({ ok: false, error: { code: "REVIEW_INVALID", fields: ["adoption"] } });
    const noPerson = { adoption: { status: "REJECTED", decidedAt: "2026-11-06T00:00:00Z", reason: "x" } } as unknown as Parameters<typeof recordDatasetReview>[2];
    expect(await recordDatasetReview(current.store, KEY, noPerson)).toEqual({ ok: false, error: { code: "REVIEW_INVALID", fields: ["adoption"] } });
  });

  it("refuses a call with no review, and a data set that has no record", async () => {
    const current = await worldWithSource(true);
    expect(await recordDatasetReview(current.store, KEY, {})).toEqual({ ok: false, error: { code: "REVIEW_EMPTY" } });
    expect(await recordDatasetReview(current.store, "no-such-key", { usage: USAGE })).toEqual({ ok: false, error: { code: "RECORD_NOT_FOUND" } });
  });

  it("does not change the sources of a data set when the data set is reviewed", async () => {
    const current = await worldWithSource(true);
    const before = await current.readText(sourceFile(current));
    await recordDatasetReview(current.store, KEY, { usage: USAGE });
    expect(await current.readText(sourceFile(current))).toBe(before);
  });
});
