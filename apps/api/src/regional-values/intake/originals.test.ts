import { unlink } from "node:fs/promises";

import { sha256Hex } from "@ehime-vote-navigator/domain";
import { afterEach, describe, expect, it } from "vitest";

import { createIntakeWorld, expectedOf, intakeRequest } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import type { IntakeWorld } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import { encodeUtf8 } from "../../../../../tests/harness/regional-values/shiftJis.js";
import { intakeCsv } from "./intake.js";
import { compareWithExpected, verifyStoredOriginals } from "./originals.js";
import { readRealSources } from "./sourceRecords.js";

// Fictional files only. The look at the originals reads, and writes nothing.

const CLOCK = (): Date => new Date("2026-11-13T00:00:00Z");

let world: IntakeWorld | undefined;

async function newWorld(): Promise<IntakeWorld> {
  world = await createIntakeWorld();
  return world;
}

afterEach(async () => {
  await world?.remove();
  world = undefined;
});

const RAW = "fictional-shelters/r1/shelters.csv";

async function stored(current: IntakeWorld): Promise<Awaited<ReturnType<typeof verifyStoredOriginals>>> {
  const sources = await readRealSources(current.store);
  if (!sources.ok) {
    throw new Error("The sources were not read");
  }
  return verifyStoredOriginals(current.store, sources.value);
}

describe("compareWithExpected", () => {
  const bytes = encodeUtf8("名称,件数\nあおば,1\n");

  it("matches when the SHA-256 and the size are the ones that were told", () => {
    expect(compareWithExpected(bytes, expectedOf(bytes))).toEqual({ sha256: sha256Hex(bytes), byteLength: bytes.byteLength, sha256Matches: true, byteLengthMatches: true, matches: true });
  });

  it.each([
    ["the SHA-256", { sha256: "3".repeat(64), byteLength: bytes.byteLength }, false, true],
    ["the size", { sha256: sha256Hex(bytes), byteLength: bytes.byteLength + 1 }, true, false],
    ["both", { sha256: "3".repeat(64), byteLength: 0 }, false, false],
  ])("says which of the two is not the one that was told: %s", (_name, expected, sha256Matches, byteLengthMatches) => {
    const compared = compareWithExpected(bytes, expected);
    expect(compared).toMatchObject({ sha256Matches, byteLengthMatches, matches: false });
    expect(compared.sha256).toBe(sha256Hex(bytes));
  });

  it("does not take a file that has the same size for the same file, nor a file that has the same SHA-256 of another size for it", () => {
    const sameSize = encodeUtf8("名称,件数\nあおば,2\n");
    expect(sameSize.byteLength).toBe(bytes.byteLength);
    expect(compareWithExpected(sameSize, expectedOf(bytes)).matches).toBe(false);
  });
});

describe("verifyStoredOriginals", () => {
  it("says MATCH for an original that is the file that was taken in, with its SHA-256 and its size", async () => {
    const current = await newWorld();
    const request = intakeRequest();
    await intakeCsv(current.store, request, CLOCK);
    const reports = await stored(current);
    expect(reports).toEqual({
      ok: true,
      value: [{ sourceId: "fictional-shelters", revision: "r1", state: "MATCH", recordedSha256: sha256Hex(request.bytes), currentSha256: sha256Hex(request.bytes), byteLength: request.bytes.byteLength }],
    });
  });

  it("says CHANGED for a file that is not the one that was taken in, and tells the SHA-256 that it has now", async () => {
    const current = await newWorld();
    const request = intakeRequest();
    await intakeCsv(current.store, request, CLOCK);
    const other = encodeUtf8("名称,件数\nあおば,999\n");
    await current.putRaw(RAW, other);
    const reports = await stored(current);
    expect(reports).toEqual({
      ok: true,
      value: [{ sourceId: "fictional-shelters", revision: "r1", state: "CHANGED", recordedSha256: sha256Hex(request.bytes), currentSha256: sha256Hex(other), byteLength: other.byteLength }],
    });
  });

  it("says MISSING for an original that is not there: no file, or no directory", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, intakeRequest(), CLOCK);
    await unlink(current.rawPath(RAW));
    expect(await stored(current)).toMatchObject({ ok: true, value: [{ state: "MISSING", currentSha256: null, byteLength: null }] });
  });

  it("says MATCH when another file is beside the original, as long as one of the files is the original", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, intakeRequest(), CLOCK);
    await current.putRaw("fictional-shelters/r1/notes.txt", encodeUtf8("a note of a person"));
    expect(await stored(current)).toMatchObject({ ok: true, value: [{ state: "MATCH" }] });
  });

  it("looks at each revision on its own, in the order of the source ID and the revision", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, intakeRequest({ sourceId: "second-source", fileName: "b.csv", bytes: encodeUtf8("名称,件数\nみなと,5\n") }), CLOCK);
    await intakeCsv(current.store, intakeRequest(), CLOCK);
    await intakeCsv(current.store, intakeRequest({ bytes: encodeUtf8("名称,件数\nあおば,2\n") }), CLOCK);
    await current.putRaw("fictional-shelters/r1/shelters.csv", encodeUtf8("changed"));
    const reports = await stored(current);
    expect(reports.ok && reports.value.map((report) => `${report.sourceId}/${report.revision}:${report.state}`)).toEqual([
      "fictional-shelters/r1:CHANGED",
      "fictional-shelters/r2:MATCH",
      "second-source/r1:MATCH",
    ]);
  });

  it("is empty when there is no source, and writes nothing", async () => {
    const current = await newWorld();
    expect(await stored(current)).toEqual({ ok: true, value: [] });
    await intakeCsv(current.store, intakeRequest(), CLOCK);
    const before = await current.files();
    await stored(current);
    expect(await current.files()).toEqual(before);
  });
});
