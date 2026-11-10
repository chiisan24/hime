import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  StageRunKeySchema,
  StageRunSchema,
  type StageRun,
  type StageRunKey,
} from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { withTemporaryTestDirectory } from "../../../../tests/harness/temporary-directory.js";
import { computeStageRunId, createFileStageStore, latestSucceeded } from "./stageStore.js";

const SHA = "a".repeat(64);

function makeKey(overrides: Record<string, unknown> = {}): StageRunKey {
  return StageRunKeySchema.parse({
    sourceSha256: SHA,
    revision: "r1",
    stage: "EXTRACT",
    modelId: null,
    inputHash: "b".repeat(64),
    ...overrides,
  });
}

function makeRun(
  options: {
    createdAt?: string;
    input?: unknown;
    keyOverrides?: Record<string, unknown>;
    output?: unknown;
    status?: "FAILED" | "SUCCEEDED";
  } = {},
): StageRun {
  const key = makeKey(options.keyOverrides);
  const status = options.status ?? "SUCCEEDED";
  return StageRunSchema.parse({
    stageRunId: computeStageRunId(key),
    key,
    runId: "run-1",
    scope: "STAGE",
    passageId: null,
    status,
    input: options.input ?? { sample: 1 },
    output: status === "SUCCEEDED" ? (options.output ?? { value: "ok" }) : null,
    errorClass: status === "SUCCEEDED" ? null : "STAGE_ERROR",
    createdAt: options.createdAt ?? "2026-11-05T00:00:00.000Z",
  });
}

function directoryOf(root: string, key: StageRunKey): string {
  return join(root, "stages", key.sourceSha256, key.revision, key.stage);
}

describe("createFileStageStore", () => {
  it("saves a SUCCEEDED run once under stages/<sha256>/<revision>/<stage> and finds it by key", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const store = createFileStageStore({ realDataRoot: base });
      const run = makeRun();

      expect((await store.saveRun(run)).ok).toBe(true);
      const found = await store.findSucceeded(run.key);

      expect(found).toEqual({ ok: true, value: run });
      expect(await readdir(directoryOf(base, run.key))).toEqual([`${run.stageRunId}.json`]);
    }, "stage-store-save");
  });

  it("finds nothing when any one of the five key elements differs", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const store = createFileStageStore({ realDataRoot: base });
      await store.saveRun(makeRun());

      for (const overrides of [
        { sourceSha256: "c".repeat(64) },
        { revision: "r2" },
        { stage: "CLASSIFY" },
        { modelId: "jp.anthropic.claude-haiku-5-5" },
        { inputHash: "d".repeat(64) },
      ]) {
        expect(await store.findSucceeded(makeKey(overrides))).toEqual({ ok: true, value: null });
      }
    }, "stage-store-key");
  });

  it("keeps a FAILED run in its own file and never lets it replace or become a SUCCEEDED run", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const store = createFileStageStore({ realDataRoot: base });
      const succeeded = makeRun();
      const failed = makeRun({ status: "FAILED", createdAt: "2026-11-05T01:00:00.000Z" });
      await store.saveRun(succeeded);
      const before = await readFile(join(directoryOf(base, succeeded.key), `${succeeded.stageRunId}.json`));

      expect((await store.saveRun(failed)).ok).toBe(true);

      const after = await readFile(join(directoryOf(base, succeeded.key), `${succeeded.stageRunId}.json`));
      expect(after.equals(before)).toBe(true);
      expect(await readdir(directoryOf(base, succeeded.key))).toHaveLength(2);
      expect(await store.findSucceeded(succeeded.key)).toEqual({ ok: true, value: succeeded });
    }, "stage-store-failed");
  });

  it("does not treat a FAILED run alone as a hit", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const store = createFileStageStore({ realDataRoot: base });
      const failed = makeRun({ status: "FAILED" });

      await store.saveRun(failed);

      expect(await store.findSucceeded(failed.key)).toEqual({ ok: true, value: null });
      const listed = await store.listRuns(failed.key);
      expect(listed.ok && listed.value.map((run) => run.status)).toEqual(["FAILED"]);
    }, "stage-store-failed-only");
  });

  it("accepts the same run twice but refuses a different SUCCEEDED run for the same key", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const store = createFileStageStore({ realDataRoot: base });
      const first = makeRun();
      await store.saveRun(first);

      expect((await store.saveRun(first)).ok).toBe(true);
      const other = await store.saveRun(makeRun({ output: { value: "different" } }));

      expect(other).toEqual({ ok: false, error: { code: "STORE_WRITE_FAILED" } });
      expect(await store.findSucceeded(first.key)).toEqual({ ok: true, value: first });
    }, "stage-store-conflict");
  });

  it("leaves existing files untouched and creates no new file when the commit fails", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const healthy = createFileStageStore({ realDataRoot: base });
      const first = makeRun();
      await healthy.saveRun(first);
      const directory = directoryOf(base, first.key);
      const before = await readFile(join(directory, `${first.stageRunId}.json`));
      const broken = createFileStageStore({
        realDataRoot: base,
        operations: {
          rename: async () => {
            throw new Error("rename blocked");
          },
        },
      });

      const result = await broken.saveRun(makeRun({ status: "FAILED" }));

      expect(result).toEqual({ ok: false, error: { code: "STORE_WRITE_FAILED" } });
      expect(await readdir(directory)).toEqual([`${first.stageRunId}.json`]);
      expect((await readFile(join(directory, `${first.stageRunId}.json`))).equals(before)).toBe(true);
    }, "stage-store-rename");
  });

  it("lists every run of a stage, oldest first", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const store = createFileStageStore({ realDataRoot: base });
      const late = makeRun({ createdAt: "2026-11-05T05:00:00.000Z" });
      const early = makeRun({
        createdAt: "2026-11-05T01:00:00.000Z",
        keyOverrides: { inputHash: "e".repeat(64) },
      });
      const failed = makeRun({ status: "FAILED", createdAt: "2026-11-05T03:00:00.000Z" });
      for (const run of [late, failed, early]) {
        await store.saveRun(run);
      }

      const listed = await store.listRuns(late.key);

      expect(listed.ok && listed.value.map((run) => run.createdAt)).toEqual([
        "2026-11-05T01:00:00.000Z",
        "2026-11-05T03:00:00.000Z",
        "2026-11-05T05:00:00.000Z",
      ]);
      expect(listed.ok && latestSucceeded(listed.value)?.createdAt).toBe("2026-11-05T05:00:00.000Z");
      expect(await store.listRuns(makeKey({ revision: "r9" }))).toEqual({ ok: true, value: [] });
    }, "stage-store-list");
  });

  it("fails closed on a corrupt or mismatched run file", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const store = createFileStageStore({ realDataRoot: base });
      const run = makeRun();
      const directory = directoryOf(base, run.key);
      await mkdir(directory, { recursive: true });

      await writeFile(join(directory, `${run.stageRunId}.json`), "{ not json");
      expect(await store.findSucceeded(run.key)).toEqual({ ok: false, error: { code: "STORE_READ_FAILED" } });
      expect(await store.listRuns(run.key)).toEqual({ ok: false, error: { code: "STORE_READ_FAILED" } });

      const foreign = makeRun({ keyOverrides: { inputHash: "f".repeat(64) } });
      await writeFile(join(directory, `${run.stageRunId}.json`), JSON.stringify(foreign));
      expect(await store.findSucceeded(run.key)).toEqual({ ok: false, error: { code: "STORE_READ_FAILED" } });
    }, "stage-store-corrupt");
  });

  it("ignores files that are not run files", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const store = createFileStageStore({ realDataRoot: base });
      const run = makeRun();
      await store.saveRun(run);
      await writeFile(join(directoryOf(base, run.key), ".leftover.tmp"), "partial");

      const listed = await store.listRuns(run.key);

      expect(listed.ok && listed.value).toEqual([run]);
    }, "stage-store-ignore");
  });

  it("rejects an unsafe key or an inconsistent run without touching the disk", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const store = createFileStageStore({ realDataRoot: base });
      const run = makeRun();

      expect(await store.findSucceeded({ ...run.key, revision: "../x" } as unknown as StageRunKey)).toEqual({
        ok: false,
        error: { code: "INVALID_RUN" },
      });
      expect(await store.listRuns({ ...run.key, stage: "NOPE" } as unknown as StageRunKey)).toEqual({
        ok: false,
        error: { code: "INVALID_RUN" },
      });
      expect(await store.saveRun({ ...run, stageRunId: "0".repeat(64) } as StageRun)).toEqual({
        ok: false,
        error: { code: "INVALID_RUN" },
      });
      expect(await store.saveRun(makeRun({ input: 1n }))).toEqual({
        ok: false,
        error: { code: "INVALID_RUN" },
      });
      expect(await readdir(base)).toEqual([]);
    }, "stage-store-invalid");
  });
});