import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DraftEventSchema } from "@ehime-vote-navigator/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createTempRoot, eventOf, hashOfName } from "../../../../../tests/harness/regional-values/draftSupport.js";
import type { TempRoot } from "../../../../../tests/harness/regional-values/draftSupport.js";
import { readRecords } from "./recordReader.js";
import { FIXTURE_LOGICAL_ROOT, REAL_LOGICAL_ROOT } from "./types.js";

let temp: TempRoot | undefined;

afterEach(async () => {
  await temp?.remove();
  temp = undefined;
});

async function put(root: TempRoot, relativePath: string, value: unknown): Promise<void> {
  const target = join(root.root.rootDir, relativePath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

const anyRecord = z.object({}).passthrough();

describe("readRecords", () => {
  it("returns no records for a directory that does not exist", async () => {
    temp = await createTempRoot("FIXTURE");
    const result = await readRecords(temp.root, "events", DraftEventSchema);
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("reads the records of fictional data, in the order of their paths", async () => {
    temp = await createTempRoot("FIXTURE");
    const first = eventOf({ kind: "DRAFTED", draftId: hashOfName("a") });
    const second = eventOf({ kind: "DRAFTED", draftId: hashOfName("b") });
    for (const event of [second, first]) {
      await put(temp, `events/${event.eventId}.json`, event);
    }
    const result = await readRecords(temp.root, "events", DraftEventSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((stored) => stored.record.eventId)).toEqual([first.eventId, second.eventId].sort());
      expect(result.value.every((stored) => stored.relativePath.startsWith("events/"))).toBe(true);
    }
  });

  it("reads the records of real data from the place of real data", async () => {
    temp = await createTempRoot("REAL_AI");
    const event = eventOf({ kind: "DRAFTED", dataKind: "REAL_AI" });
    await put(temp, `events/${event.eventId}.json`, event);
    const result = await readRecords(temp.root, "events", DraftEventSchema);
    expect(result.ok).toBe(true);
  });

  it("fails when a record of the other data kind is among the records (the kinds are not mixed)", async () => {
    for (const [rootKind, otherKind] of [
      ["FIXTURE", "REAL_AI"],
      ["REAL_AI", "FIXTURE"],
    ] as const) {
      temp = await createTempRoot(rootKind);
      const own = eventOf({ kind: "DRAFTED", dataKind: rootKind, draftId: hashOfName("own") });
      const other = eventOf({ kind: "DRAFTED", dataKind: otherKind, draftId: hashOfName("other") });
      await put(temp, `events/${own.eventId}.json`, own);
      await put(temp, `events/${other.eventId}.json`, other);
      expect(await readRecords(temp.root, "events", DraftEventSchema)).toEqual({ ok: false, error: { code: "DATA_KIND_MIXED" } });
      await temp.remove();
    }
    temp = undefined;
  });

  it("fails when the place is not the place of the data kind", async () => {
    temp = await createTempRoot("REAL_AI");
    const event = eventOf({ kind: "DRAFTED", dataKind: "REAL_AI" });
    await put(temp, `events/${event.eventId}.json`, event);
    for (const logicalRoot of [FIXTURE_LOGICAL_ROOT, "docs/regional-values", "dist/regional-values"]) {
      const result = await readRecords({ ...temp.root, logicalRoot }, "events", DraftEventSchema);
      expect(result).toEqual({ ok: false, error: { code: "STORAGE_ROOT_MISMATCH" } });
    }
    const fixture = await createTempRoot("FIXTURE");
    const fictional = eventOf({ kind: "DRAFTED" });
    await put(fixture, `events/${fictional.eventId}.json`, fictional);
    expect(await readRecords({ ...fixture.root, logicalRoot: REAL_LOGICAL_ROOT }, "events", DraftEventSchema)).toEqual({
      ok: false,
      error: { code: "STORAGE_ROOT_MISMATCH" },
    });
    await fixture.remove();
  });

  it("fails for a record that does not say its data kind, unless the records are known to have none", async () => {
    temp = await createTempRoot("FIXTURE");
    await put(temp, "approvals/a.json", { type: "APPROVE" });
    expect(await readRecords(temp.root, "approvals", anyRecord)).toEqual({ ok: false, error: { code: "DATA_KIND_INVALID" } });
    await put(temp, "approvals/b.json", { dataKind: "SOMETHING_ELSE" });
    expect(await readRecords(temp.root, "approvals", anyRecord)).toEqual({ ok: false, error: { code: "DATA_KIND_INVALID" } });
    const ledger = await createTempRoot("FIXTURE");
    await put(ledger, "approvals/a.json", { type: "APPROVE" });
    expect((await readRecords(ledger.root, "approvals", anyRecord, { declaresDataKind: false })).ok).toBe(true);
    await ledger.remove();
  });

  it("fails for a file that is not JSON or does not satisfy the schema", async () => {
    temp = await createTempRoot("FIXTURE");
    await put(temp, "events/broken.json", "{ not json");
    expect(await readRecords(temp.root, "events", DraftEventSchema)).toEqual({ ok: false, error: { code: "RECORD_INVALID" } });
    await put(temp, "events/broken.json", { dataKind: "FIXTURE" });
    expect(await readRecords(temp.root, "events", DraftEventSchema)).toEqual({ ok: false, error: { code: "RECORD_INVALID" } });
  });

  it("reads sub-directories only when asked, and only the .json files", async () => {
    temp = await createTempRoot("FIXTURE");
    const event = eventOf({ kind: "DRAFTED" });
    await put(temp, `events/${event.eventId}.json`, event);
    await put(temp, "events/nested/inner.json", eventOf({ kind: "DRAFTED", draftId: hashOfName("inner") }));
    await put(temp, "events/notes.txt", "ignored");
    const flat = await readRecords(temp.root, "events", DraftEventSchema);
    expect(flat.ok && flat.value.length).toBe(1);
    const deep = await readRecords(temp.root, "events", DraftEventSchema, { recursive: true });
    expect(deep.ok && deep.value.map((stored) => stored.relativePath).sort()).toEqual(
      [`events/${event.eventId}.json`, "events/nested/inner.json"].sort(),
    );
  });
});
