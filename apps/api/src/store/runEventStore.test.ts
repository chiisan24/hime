import {
  access,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { RunEventPayloadSchema, type RunEvent } from "@ehime-vote-navigator/contracts";
import {
  REDACTED_VALUE,
  createRunEvent,
  encodeCanonicalJson,
  sha256Hex,
} from "@ehime-vote-navigator/domain";
import { describe, expect, it } from "vitest";

import {
  createPendingAnalysisRun,
  createRunEventAppend,
} from "../../../../tests/harness/run-event-fixture.js";
import { withTemporaryTestDirectory } from "../../../../tests/harness/temporary-directory.js";
import {
  RunEventStoreError,
  createRunEventStore,
} from "./runEventStore.js";

const RECORDED_NONCE_COUNTEREXAMPLE =
  "_7mdImaYAdAVsMQC1xb3hQHGc975-87932kCjSIF-QQ";
const RECORDED_REQUEST_ID_COUNTEREXAMPLE =
  "71f9383a-0201-4659-ba07-06d9d35b0302";

const RUN_STORE_COUNTEREXAMPLE_CASES = Object.freeze([
  Object.freeze({
    name: "nonce-only",
    diagnostic: RECORDED_NONCE_COUNTEREXAMPLE,
  }),
  Object.freeze({
    name: "request-id-only",
    diagnostic: RECORDED_REQUEST_ID_COUNTEREXAMPLE,
  }),
  Object.freeze({
    name: "nonce-and-request-id",
    diagnostic: `${RECORDED_NONCE_COUNTEREXAMPLE} ${RECORDED_REQUEST_ID_COUNTEREXAMPLE}`,
  }),
]);

async function createRunRoot(temporaryRoot: string): Promise<string> {
  const runRoot = join(temporaryRoot, "run-fixture");
  await mkdir(runRoot, { recursive: true });
  return runRoot;
}

function runCreatedAppend() {
  const run = createPendingAnalysisRun();
  return createRunEventAppend(
    RunEventPayloadSchema.parse({ type: "RUN_CREATED", run }),
  );
}

function createFirstEvent(): RunEvent {
  return createRunEvent({
    ...runCreatedAppend(),
    sequence: 1,
    previousEventHash: null,
  });
}

async function writeEventFixture(
  runRoot: string,
  filename: string,
  event: unknown,
): Promise<void> {
  const eventsPath = join(runRoot, "events");
  await mkdir(eventsPath, { recursive: true });
  await writeFile(join(eventsPath, filename), encodeCanonicalJson(event));
}

async function expectStoreError(
  operation: Promise<unknown>,
  code: RunEventStoreError["code"],
): Promise<void> {
  try {
    await operation;
    throw new Error("Expected the run event store operation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(RunEventStoreError);
    expect((error as RunEventStoreError).code).toBe(code);
  }
}

async function expectMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toThrow();
}

describe("immutable run event store", () => {
  it("atomically appends numbered events and rebuilds the run from committed files", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const runRoot = await createRunRoot(temporaryRoot);
      const store = createRunEventStore({ allowedRoot: runRoot });

      const first = await store.append(runCreatedAppend());
      const second = await store.append(
        createRunEventAppend(
          RunEventPayloadSchema.parse({
            type: "SAFE_DIAGNOSTIC_RECORDED",
            diagnostic: "Committed fixture diagnostic.",
          }),
        ),
      );
      const inspection = await store.inspect();

      expect(first.relativePath).toBe("events/000001.json");
      expect(second.relativePath).toBe("events/000002.json");
      expect(second.event.previousEventHash).toBe(first.event.eventHash);
      expect(await readdir(join(runRoot, "events"))).toEqual([
        "000001.json",
        "000002.json",
      ]);
      expect(inspection).toMatchObject({
        status: "HEALTHY",
        diagnostics: [],
        quarantineTargets: [],
      });
      expect(inspection.run?.safeDiagnostics).toEqual([
        "Committed fixture diagnostic.",
      ]);
      expect(inspection.lastEventHash).toBe(second.event.eventHash);

      const storedBytes = await readFile(join(runRoot, "events", "000001.json"));
      expect(storedBytes).toEqual(Buffer.from(encodeCanonicalJson(first.event)));
      expect(Object.keys(store).sort()).toEqual([
        "append",
        "commitIndex",
        "inspect",
        "readIndex",
      ]);
      expect("update" in store).toBe(false);
      expect("delete" in store).toBe(false);
    }, "run-event-append");
  });

  it("redacts protected diagnostics before committing run history", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const runRoot = await createRunRoot(temporaryRoot);
      const store = createRunEventStore({ allowedRoot: runRoot });
      const fictionalBearer = "Bearer fictional.history.token";
      const input = createRunEventAppend(
        RunEventPayloadSchema.parse({
          type: "SAFE_DIAGNOSTIC_RECORDED",
          diagnostic: fictionalBearer,
        }),
      );

      await store.append(runCreatedAppend());
      const result = await store.append(input);
      const stored = await readFile(
        join(runRoot, "events", "000002.json"),
        "utf8",
      );

      expect(result.event.payload).toEqual({
        type: "SAFE_DIAGNOSTIC_RECORDED",
        diagnostic: REDACTED_VALUE,
      });
      expect(stored).not.toContain(fictionalBearer);
      expect(stored).toContain(REDACTED_VALUE);
      expect(input.payload).toEqual({
        type: "SAFE_DIAGNOSTIC_RECORDED",
        diagnostic: fictionalBearer,
      });
    }, "run-event-redaction");
  });

  it("detects gaps, duplicate sequences, and invalid hashes without repairing files", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const gapRoot = await createRunRoot(join(temporaryRoot, "gap"));
      const first = createFirstEvent();
      const third = createRunEvent({
        ...createRunEventAppend(
          RunEventPayloadSchema.parse({
            type: "SAFE_DIAGNOSTIC_RECORDED",
            diagnostic: "Sequence three fixture.",
          }),
        ),
        sequence: 3,
        previousEventHash: first.eventHash,
      });
      await writeEventFixture(gapRoot, "000001.json", first);
      await writeEventFixture(gapRoot, "000003.json", third);

      const gapInspection = await createRunEventStore({
        allowedRoot: gapRoot,
      }).inspect();
      expect(gapInspection.status).toBe("QUARANTINED");
      expect(gapInspection.run).toBeNull();
      expect(gapInspection.diagnostics).toContainEqual(
        expect.objectContaining({ code: "SEQUENCE_GAP", sequence: 2 }),
      );
      expect(await readdir(join(gapRoot, "events"))).toEqual([
        "000001.json",
        "000003.json",
      ]);

      const duplicateRoot = await createRunRoot(join(temporaryRoot, "duplicate"));
      const duplicate = createRunEvent({
        ...createRunEventAppend(
          RunEventPayloadSchema.parse({
            type: "SAFE_DIAGNOSTIC_RECORDED",
            diagnostic: "Duplicate fixture.",
          }),
        ),
        sequence: 1,
        previousEventHash: first.eventHash,
      });
      await writeEventFixture(duplicateRoot, "000001.json", first);
      await writeEventFixture(duplicateRoot, "000002.json", duplicate);
      const duplicateInspection = await createRunEventStore({
        allowedRoot: duplicateRoot,
      }).inspect();
      expect(duplicateInspection.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "DUPLICATE_SEQUENCE" }),
          expect.objectContaining({ code: "EVENT_FILENAME_MISMATCH" }),
        ]),
      );
      expect(duplicateInspection.run).toBeNull();

      const hashRoot = await createRunRoot(join(temporaryRoot, "hash"));
      const invalidHash = { ...first, eventHash: "f".repeat(64) };
      await writeEventFixture(hashRoot, "000001.json", invalidHash);
      const hashInspection = await createRunEventStore({
        allowedRoot: hashRoot,
      }).inspect();
      expect(hashInspection.diagnostics).toContainEqual(
        expect.objectContaining({ code: "EVENT_HASH_MISMATCH" }),
      );
      expect(hashInspection.run).toBeNull();
      expect(await readFile(join(hashRoot, "events", "000001.json"))).toEqual(
        Buffer.from(encodeCanonicalJson(invalidHash)),
      );
    }, "run-event-corruption");
  });

  it("reports interrupted temporary files and append locks as quarantine targets", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const runRoot = await createRunRoot(temporaryRoot);
      const store = createRunEventStore({ allowedRoot: runRoot });
      await store.append(runCreatedAppend());
      const temporaryPath = join(
        runRoot,
        "events",
        ".000002.json.interrupted.tmp",
      );
      const lockPath = join(runRoot, "events", ".append.lock");
      await writeFile(temporaryPath, "partial", "utf8");
      await writeFile(lockPath, "interrupted", "utf8");

      const inspection = await store.inspect();

      expect(inspection.status).toBe("QUARANTINED");
      expect(inspection.run?.runId).toBe("run-event-fixture-1");
      expect(inspection.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "STALE_TEMPORARY" }),
          expect.objectContaining({ code: "STALE_APPEND_LOCK" }),
        ]),
      );
      expect(inspection.quarantineTargets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            relativePath: "events/.000002.json.interrupted.tmp",
          }),
          expect.objectContaining({ relativePath: "events/.append.lock" }),
        ]),
      );
      expect(await readFile(temporaryPath, "utf8")).toBe("partial");
      expect(await readFile(lockPath, "utf8")).toBe("interrupted");
      await expectStoreError(
        store.append(
          createRunEventAppend(
            RunEventPayloadSchema.parse({
              type: "SAFE_DIAGNOSTIC_RECORDED",
              diagnostic: "Must not be appended.",
            }),
          ),
        ),
        "CONCURRENT_APPEND_CONFLICT",
      );
    }, "run-event-interruption");
  });

  it("allows only one of two simultaneous appends to reserve a sequence", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const runRoot = await createRunRoot(temporaryRoot);
      const store = createRunEventStore({ allowedRoot: runRoot });
      const input = runCreatedAppend();

      const results = await Promise.allSettled([
        store.append(input),
        store.append(input),
      ]);

      expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      const rejected = results.find(({ status }) => status === "rejected");
      expect(rejected?.status).toBe("rejected");
      if (rejected?.status === "rejected") {
        expect(rejected.reason).toBeInstanceOf(RunEventStoreError);
        expect((rejected.reason as RunEventStoreError).code).toBe(
          "CONCURRENT_APPEND_CONFLICT",
        );
      }
      const inspection = await store.inspect();
      expect(inspection.status).toBe("HEALTHY");
      expect(inspection.events).toHaveLength(1);
      expect(await readdir(join(runRoot, "events"))).toEqual(["000001.json"]);
    }, "run-event-concurrency");
  });

  it("refuses to append when committed event data is already quarantined", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const runRoot = await createRunRoot(temporaryRoot);
      const first = createFirstEvent();
      await writeEventFixture(runRoot, "000001.json", {
        ...first,
        eventHash: "f".repeat(64),
      });
      const store = createRunEventStore({ allowedRoot: runRoot });

      await expectStoreError(
        store.append(
          createRunEventAppend(
            RunEventPayloadSchema.parse({
              type: "SAFE_DIAGNOSTIC_RECORDED",
              diagnostic: "Must remain uncommitted.",
            }),
          ),
        ),
        "EVENT_STORE_QUARANTINED",
      );
      expect(await readdir(join(runRoot, "events"))).toEqual(["000001.json"]);
    }, "run-event-quarantined-append");
  });
});

describe("immutable index commit marker", () => {
  it("validates every index file before creating COMMITTED.json last", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const runRoot = await createRunRoot(temporaryRoot);
      const store = createRunEventStore({ allowedRoot: runRoot });
      const firstBytes = new TextEncoder().encode("fixture-index-one\n");
      const secondBytes = new TextEncoder().encode("fixture-index-two\n");

      const result = await store.commitIndex("index-fixture-1", [
        {
          relativePath: "vectors/part-1.bin",
          bytes: firstBytes,
          expectedContentHash: sha256Hex(firstBytes),
        },
        { relativePath: "metadata.json", bytes: secondBytes },
      ]);
      const entries = await readdir(
        join(runRoot, "indexes", "index-fixture-1"),
      );
      const read = await store.readIndex("index-fixture-1");

      expect(result.relativePath).toBe("indexes/index-fixture-1");
      expect(entries).toContain("MANIFEST.json");
      expect(entries).toContain("COMMITTED.json");
      expect(read.status).toBe("COMMITTED");
      expect(read.diagnostics).toEqual([]);
      expect(read.manifestHash).toBe(result.manifestHash);
      expect(read.files.map(({ relativePath }) => relativePath)).toEqual([
        "metadata.json",
        "vectors/part-1.bin",
      ]);
      expect(read.files[0]?.bytes).toEqual(secondBytes);
      expect(read.files[1]?.bytes).toEqual(firstBytes);
    }, "index-commit");
  });

  it("ignores a markerless interrupted index and returns it for quarantine without deletion", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const runRoot = await createRunRoot(temporaryRoot);
      const interruptedPath = join(
        runRoot,
        "indexes",
        "index-interrupted",
      );
      await mkdir(interruptedPath, { recursive: true });
      await writeFile(join(interruptedPath, "partial.bin"), "partial", "utf8");
      const staleTemporary = join(
        runRoot,
        "indexes",
        ".index-other.interrupted.tmp",
      );
      await mkdir(staleTemporary);
      const store = createRunEventStore({ allowedRoot: runRoot });

      const read = await store.readIndex("index-interrupted");
      const inspection = await store.inspect();

      expect(read.status).toBe("IGNORED_UNCOMMITTED");
      expect(read.files).toEqual([]);
      expect(read.diagnostics).toContainEqual(
        expect.objectContaining({ code: "INDEX_COMMIT_MARKER_MISSING" }),
      );
      expect(inspection.status).toBe("QUARANTINED");
      expect(inspection.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "INDEX_COMMIT_MARKER_MISSING" }),
          expect.objectContaining({ code: "STALE_TEMPORARY" }),
        ]),
      );
      expect(await readFile(join(interruptedPath, "partial.bin"), "utf8")).toBe(
        "partial",
      );
      expect((await access(staleTemporary)) ?? undefined).toBeUndefined();
    }, "index-markerless");
  });

  it("quarantines a changed file in a committed index and never returns partial data", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const runRoot = await createRunRoot(temporaryRoot);
      const store = createRunEventStore({ allowedRoot: runRoot });
      await store.commitIndex("index-corrupted", [
        {
          relativePath: "payload.bin",
          bytes: new TextEncoder().encode("original"),
        },
      ]);
      const payloadPath = join(
        runRoot,
        "indexes",
        "index-corrupted",
        "payload.bin",
      );
      await writeFile(payloadPath, "changed", "utf8");

      const read = await store.readIndex("index-corrupted");

      expect(read.status).toBe("QUARANTINED");
      expect(read.files).toEqual([]);
      expect(read.diagnostics).toContainEqual(
        expect.objectContaining({ code: "INDEX_FILE_HASH_MISMATCH" }),
      );
      expect(await readFile(payloadPath, "utf8")).toBe("changed");
    }, "index-corruption");
  });

  it("rejects a bad expected hash before creating an index directory", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const runRoot = await createRunRoot(temporaryRoot);
      const store = createRunEventStore({ allowedRoot: runRoot });

      await expectStoreError(
        store.commitIndex("index-invalid", [
          {
            relativePath: "payload.bin",
            bytes: new TextEncoder().encode("fixture"),
            expectedContentHash: "f".repeat(64),
          },
        ]),
        "INVALID_INDEX_INPUT",
      );
      await expectMissing(join(runRoot, "indexes", "index-invalid"));
      await expectMissing(
        join(runRoot, "indexes", "index-invalid", "COMMITTED.json"),
      );
    }, "index-invalid-input");
  });
});

describe("Property 2: Preservation - run event store", () => {
  // Feature: session-api-redaction-regression, Property 2: Preservation
  // **Validates: Requirements 3.6, 3.7**
  it.each(RUN_STORE_COUNTEREXAMPLE_CASES)(
    "redacts $name diagnostic before append without mutating input",
    async ({ name, diagnostic }) => {
      await withTemporaryTestDirectory(async (temporaryRoot) => {
        const runRoot = await createRunRoot(temporaryRoot);
        const store = createRunEventStore({ allowedRoot: runRoot });
        const input = createRunEventAppend(
          RunEventPayloadSchema.parse({
            type: "SAFE_DIAGNOSTIC_RECORDED",
            diagnostic,
          }),
        );
        const before = JSON.stringify(input);

        await store.append(runCreatedAppend());
        const result = await store.append(input);
        const stored = await readFile(
          join(runRoot, "events", "000002.json"),
          "utf8",
        );

        expect(result.event.payload).toEqual({
          type: "SAFE_DIAGNOSTIC_RECORDED",
          diagnostic: REDACTED_VALUE,
        });
        expect(stored).toContain(REDACTED_VALUE);
        expect(stored).not.toContain(RECORDED_NONCE_COUNTEREXAMPLE);
        expect(stored).not.toContain(RECORDED_REQUEST_ID_COUNTEREXAMPLE);
        expect(JSON.stringify(input)).toBe(before);
      }, `run-event-${name}-preservation`);
    },
  );
});