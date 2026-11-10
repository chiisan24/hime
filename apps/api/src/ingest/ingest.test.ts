import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import {
  IngestRecordSchema,
  SourceManifestRecordSchema,
  rawObjectRelativePath,
  type IngestRecord,
} from "@ehime-vote-navigator/contracts";
import {
  loadRegistry,
  sha256Hex,
  type ValidatedRegistry,
} from "@ehime-vote-navigator/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withTemporaryTestDirectory } from "../../../../tests/harness/temporary-directory.js";
import {
  decideIngest,
  ingest,
  toManifestDraft,
  type IngestRequest,
} from "./ingest.js";
import { createFileIngestStore } from "./ingestStore.js";
import { createManualPlacementSupplier } from "./manualPlacementSupplier.js";
import type { SourceSupplier, SuppliedSource } from "./sourceSupplier.js";

const ELECTION_ID = "test-election-a";
const OTHER_ELECTION_ID = "test-election-b";
const CANDIDATE_ID = "candidate-a";
const OFFICIAL_URL = "https://example.test/official/bulletin.pdf";
const RETRIEVED_AT = "2026-11-08T03:04:05.000Z";
const MARKER = "SECRET-DOCUMENT-TEXT-MARKER";

// Fictional placeholder bytes that only look like a PDF header; no real document.
function pdfBytes(label: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4\n% ${MARKER} ${label}\n%%EOF\n`);
}

function createRegistry(): ValidatedRegistry {
  const loaded = loadRegistry({
    schemaVersion: 1,
    elections: [
      {
        electionId: ELECTION_ID,
        name: "Test Election A",
        electionDate: "2026-11-15",
        status: "CURRENT",
        candidates: [
          { candidateId: CANDIDATE_ID, name: "Test Candidate A", nameForms: ["Test Candidate A"] },
          { candidateId: "candidate-b", name: "Test Candidate B", nameForms: ["Test Candidate B"] },
        ],
      },
      {
        electionId: OTHER_ELECTION_ID,
        name: "Test Election B",
        electionDate: "2022-11-20",
        status: "PAST",
        candidates: [
          { candidateId: "candidate-c", name: "Test Candidate C", nameForms: ["Test Candidate C"] },
        ],
      },
    ],
  });
  if (!loaded.ok) {
    throw new Error("fixture registry invalid");
  }
  return loaded.value;
}

async function createRealDataRoot(base: string): Promise<string> {
  const realDataRoot = join(base, "data", "real");
  await mkdir(join(realDataRoot, "raw"), { recursive: true });
  return realDataRoot;
}

function supplied(label: string, overrides: Partial<SuppliedSource> = {}): SuppliedSource {
  return {
    bytes: pdfBytes(label),
    officialUrl: OFFICIAL_URL,
    retrievedAt: RETRIEVED_AT,
    ...overrides,
  };
}

function request(overrides: Partial<IngestRequest> = {}): IngestRequest {
  return {
    sourceId: "bulletin-a",
    electionId: ELECTION_ID,
    assignment: { state: "UNASSIGNED" },
    ...overrides,
  };
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    .sort();
}

function recordFor(overrides: Record<string, unknown> = {}): IngestRecord {
  const sha256 = sha256Hex(pdfBytes("A"));
  return IngestRecordSchema.parse({
    sourceId: "bulletin-a",
    electionId: ELECTION_ID,
    revision: "r1",
    assignment: { state: "UNASSIGNED" },
    officialUrl: OFFICIAL_URL,
    retrievedAt: RETRIEVED_AT,
    sha256,
    byteLength: pdfBytes("A").byteLength,
    rawSnapshotRelativePath: rawObjectRelativePath(sha256),
    analysisStatus: "NOT_ANALYZED",
    approvalStatus: "PENDING",
    ...overrides,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("decideIngest", () => {
  const shaA = sha256Hex(pdfBytes("A"));
  const shaB = sha256Hex(pdfBytes("B"));

  it("starts at r1 when nothing is registered", () => {
    expect(decideIngest(undefined, shaA)).toEqual({ kind: "CREATE", revision: "r1" });
  });

  it("leaves the same SHA-256 unchanged", () => {
    const latest = recordFor();
    expect(decideIngest(latest, shaA)).toEqual({ kind: "UNCHANGED", record: latest });
  });

  it("creates the next revision for a different SHA-256, including a return to older content", () => {
    const r3 = recordFor({
      revision: "r3",
      sha256: shaB,
      rawSnapshotRelativePath: rawObjectRelativePath(shaB),
    });
    expect(decideIngest(recordFor(), shaB)).toEqual({ kind: "CREATE", revision: "r2" });
    expect(decideIngest(r3, shaA)).toEqual({ kind: "CREATE", revision: "r4" });
  });
});

describe("ingest", () => {
  it("stores the body once and an immutable record for revision r1", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const realDataRoot = await createRealDataRoot(base);
      const body = supplied("A");
      const sha256 = sha256Hex(body.bytes);

      const result = await ingest(createRegistry(), createFileIngestStore({ realDataRoot }), body, request());

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      const { record, status } = result.value;
      expect(status).toBe("CREATED");
      expect(record).toMatchObject({
        sourceId: "bulletin-a",
        electionId: ELECTION_ID,
        revision: "r1",
        assignment: { state: "UNASSIGNED" },
        officialUrl: OFFICIAL_URL,
        retrievedAt: RETRIEVED_AT,
        sha256,
        byteLength: body.bytes.byteLength,
        rawSnapshotRelativePath: rawObjectRelativePath(sha256),
        analysisStatus: "NOT_ANALYZED",
        approvalStatus: "PENDING",
      });
      expect(await listFiles(realDataRoot)).toEqual(
        ["ingest/bulletin-a/r1.json", `raw/${rawObjectRelativePath(sha256)}`].sort(),
      );
      const stored = IngestRecordSchema.parse(
        JSON.parse(await readFile(join(realDataRoot, "ingest", "bulletin-a", "r1.json"), "utf8")),
      );
      expect(stored).toEqual(record);
      expect(Object.keys(stored).sort()).toEqual([
        "analysisStatus",
        "approvalStatus",
        "assignment",
        "byteLength",
        "electionId",
        "officialUrl",
        "rawSnapshotRelativePath",
        "retrievedAt",
        "revision",
        "sha256",
        "sourceId",
      ]);
      const rawBytes = await readFile(join(realDataRoot, "raw", ...rawObjectRelativePath(sha256).split("/")));
      expect(sha256Hex(rawBytes)).toBe(sha256);
    }, "ingest-create");
  });

  it("leaves everything unchanged when the same bytes arrive again", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const realDataRoot = await createRealDataRoot(base);
      const store = createFileIngestStore({ realDataRoot });
      const registry = createRegistry();
      const first = await ingest(registry, store, supplied("A"), request());
      const filesBefore = await listFiles(realDataRoot);
      const recordBytes = await readFile(join(realDataRoot, "ingest", "bulletin-a", "r1.json"));

      const again = await ingest(
        registry,
        store,
        supplied("A", { officialUrl: "https://example.test/other.pdf", retrievedAt: "2026-11-09T00:00:00.000Z" }),
        request({ assignment: { state: "SHARED" } }),
      );

      if (!first.ok || !again.ok) {
        throw new Error("Expected both ingests to succeed.");
      }
      expect(first.value.status).toBe("CREATED");
      expect(again.value.status).toBe("UNCHANGED");
      expect(again.value.record).toEqual(first.value.record);
      expect(await listFiles(realDataRoot)).toEqual(filesBefore);
      expect((await readFile(join(realDataRoot, "ingest", "bulletin-a", "r1.json"))).equals(recordBytes)).toBe(true);
    }, "ingest-unchanged");
  });

  it("adds revision r2 for changed bytes and keeps r1 byte for byte", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const realDataRoot = await createRealDataRoot(base);
      const store = createFileIngestStore({ realDataRoot });
      const registry = createRegistry();
      await ingest(registry, store, supplied("A"), request());
      const r1Bytes = await readFile(join(realDataRoot, "ingest", "bulletin-a", "r1.json"));

      const changed = await ingest(registry, store, supplied("B"), request());

      expect(changed.ok && changed.value.status).toBe("CREATED");
      expect(changed.ok && changed.value.record.revision).toBe("r2");
      expect(changed.ok && changed.value.record.sha256).toBe(sha256Hex(pdfBytes("B")));
      expect((await readFile(join(realDataRoot, "ingest", "bulletin-a", "r1.json"))).equals(r1Bytes)).toBe(true);
      expect(await listFiles(realDataRoot)).toHaveLength(4);
    }, "ingest-changed");
  });

  it("treats a return to older content as a new revision without storing the body twice", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const realDataRoot = await createRealDataRoot(base);
      const store = createFileIngestStore({ realDataRoot });
      const registry = createRegistry();
      await ingest(registry, store, supplied("A"), request());
      await ingest(registry, store, supplied("B"), request());

      const reverted = await ingest(registry, store, supplied("A"), request());

      expect(reverted.ok && reverted.value.record.revision).toBe("r3");
      const files = await listFiles(realDataRoot);
      expect(files.filter((name) => name.startsWith("raw/"))).toHaveLength(2);
      expect(files.filter((name) => name.startsWith("ingest/"))).toHaveLength(3);
    }, "ingest-revert");
  });

  it("records an explicit candidate, a shared document, and never guesses", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const realDataRoot = await createRealDataRoot(base);
      const store = createFileIngestStore({ realDataRoot });
      const registry = createRegistry();

      const assigned = await ingest(
        registry, store, supplied("A"),
        request({ sourceId: "assigned-a", assignment: { state: "ASSIGNED", candidateId: CANDIDATE_ID } }),
      );
      const shared = await ingest(
        registry, store, supplied("B"),
        request({ sourceId: "shared-a", assignment: { state: "SHARED" } }),
      );
      const unassigned = await ingest(registry, store, supplied("C"), request({ sourceId: "unassigned-a" }));

      expect(assigned.ok && assigned.value.record.assignment).toEqual({ state: "ASSIGNED", candidateId: CANDIDATE_ID });
      expect(shared.ok && shared.value.record.assignment).toEqual({ state: "SHARED" });
      expect(unassigned.ok && unassigned.value.record.assignment).toEqual({ state: "UNASSIGNED" });
    }, "ingest-assignment");
  });

  it("rejects an unknown candidate or election without writing anything", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const realDataRoot = await createRealDataRoot(base);
      const store = createFileIngestStore({ realDataRoot });
      const registry = createRegistry();

      const unknownCandidate = await ingest(
        registry, store, supplied("A"),
        request({ assignment: { state: "ASSIGNED", candidateId: "candidate-c" } }),
      );
      const unknownElection = await ingest(registry, store, supplied("A"), request({ electionId: "no-such-election" }));

      expect(!unknownCandidate.ok && unknownCandidate.error.code).toBe("UNKNOWN_CANDIDATE");
      expect(!unknownElection.ok && unknownElection.error.code).toBe("UNKNOWN_ELECTION");
      expect(await listFiles(realDataRoot)).toEqual([]);
    }, "ingest-unknown");
  });

  it.each(["", "Bulletin", "a_b", "a.b", "a b", "a".repeat(65), "con", "nul", "../x"])(
    "rejects the source ID %j without writing",
    async (sourceId) => {
      await withTemporaryTestDirectory(async (base) => {
        const realDataRoot = await createRealDataRoot(base);

        const result = await ingest(createRegistry(), createFileIngestStore({ realDataRoot }), supplied("A"), request({ sourceId }));

        expect(!result.ok && result.error.code).toBe("SOURCE_ID_INVALID");
        expect(await listFiles(realDataRoot)).toEqual([]);
      }, "ingest-bad-source");
    },
  );

  it.each([
    ["an empty body", supplied("A", { bytes: new Uint8Array(0) }), ["bytes"]],
    ["an http URL", supplied("A", { officialUrl: "http://example.test/a.pdf" }), ["officialUrl"]],
    ["a URL with credentials", supplied("A", { officialUrl: "https://u:p@example.test/a.pdf" }), ["officialUrl"]],
    ["an empty URL", supplied("A", { officialUrl: "" }), ["officialUrl"]],
    ["a time without a timezone", supplied("A", { retrievedAt: "2026-11-08T03:04:05" }), ["retrievedAt"]],
    ["a date instead of a time", supplied("A", { retrievedAt: "2026-11-08" }), ["retrievedAt"]],
    ["nothing at all", {} as SuppliedSource, ["bytes", "officialUrl", "retrievedAt"]],
    ["null", null as unknown as SuppliedSource, ["bytes", "officialUrl", "retrievedAt"]],
  ])("rejects %s as SUPPLY_INCOMPLETE and names the items", async (_label, source, fields) => {
    await withTemporaryTestDirectory(async (base) => {
      const realDataRoot = await createRealDataRoot(base);

      const result = await ingest(createRegistry(), createFileIngestStore({ realDataRoot }), source, request());

      expect(!result.ok && result.error.code).toBe("SUPPLY_INCOMPLETE");
      expect(!result.ok && result.error.fields).toEqual(fields);
      expect(await listFiles(realDataRoot)).toEqual([]);
    }, "ingest-incomplete");
  });

  it("rejects a source ID that already belongs to another election", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const realDataRoot = await createRealDataRoot(base);
      const store = createFileIngestStore({ realDataRoot });
      const registry = createRegistry();
      await ingest(registry, store, supplied("A"), request());
      const filesBefore = await listFiles(realDataRoot);

      const result = await ingest(registry, store, supplied("B"), request({ electionId: OTHER_ELECTION_ID }));

      expect(!result.ok && result.error.code).toBe("SOURCE_ELECTION_MISMATCH");
      expect(await listFiles(realDataRoot)).toEqual(filesBefore);
    }, "ingest-mismatch");
  });

  it("rejects the same document registered under another source ID", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const realDataRoot = await createRealDataRoot(base);
      const store = createFileIngestStore({ realDataRoot });
      const registry = createRegistry();
      await ingest(registry, store, supplied("A"), request());
      const filesBefore = await listFiles(realDataRoot);

      const result = await ingest(registry, store, supplied("A"), request({ sourceId: "bulletin-copy" }));

      expect(!result.ok && result.error.code).toBe("DUPLICATE_CONTENT");
      expect(!result.ok && result.error.existingSourceId).toBe("bulletin-a");
      expect(await listFiles(realDataRoot)).toEqual(filesBefore);
    }, "ingest-duplicate");
  });

  it("produces the same record whichever supplier delivered the document", async () => {
    const fromManual = await withTemporaryTestDirectory(async (base) => {
      const realDataRoot = await createRealDataRoot(base);
      await writeFile(join(realDataRoot, "raw", "bulletin.pdf"), pdfBytes("A"));
      const supplier = createManualPlacementSupplier({
        rawDirectory: join(realDataRoot, "raw"),
        officialUrl: OFFICIAL_URL,
        retrievedAt: RETRIEVED_AT,
      });
      const body = await supplier.supply("bulletin.pdf");
      if (!body.ok) {
        throw new Error("manual supplier failed");
      }
      return ingest(createRegistry(), createFileIngestStore({ realDataRoot }), body.value, request());
    }, "ingest-manual");
    const fromAutomatic = await withTemporaryTestDirectory(async (base) => {
      const realDataRoot = await createRealDataRoot(base);
      const automatic: SourceSupplier = {
        supply: async () => ({ ok: true, value: supplied("A") }),
      };
      const body = await automatic.supply("any-reference");
      if (!body.ok) {
        throw new Error("fake supplier failed");
      }
      return ingest(createRegistry(), createFileIngestStore({ realDataRoot }), body.value, request());
    }, "ingest-automatic");

    expect(fromManual.ok && fromAutomatic.ok).toBe(true);
    expect(fromManual.ok && fromAutomatic.ok && fromManual.value.record).toEqual(
      fromAutomatic.ok ? fromAutomatic.value.record : undefined,
    );
  });
});

describe("ingest failures", () => {
  it("records nothing when every write fails", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const realDataRoot = await createRealDataRoot(base);
      const store = createFileIngestStore({
        realDataRoot,
        operations: { rename: async () => { throw new Error("blocked"); } },
      });

      const result = await ingest(createRegistry(), store, supplied("A"), request());

      expect(!result.ok && result.error.code).toBe("STORE_WRITE_FAILED");
      expect(await listFiles(realDataRoot)).toEqual([]);
    }, "ingest-write-fail");
  });

  it("leaves no record when only the record write fails, and a retry succeeds", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const realDataRoot = await createRealDataRoot(base);
      const failing = createFileIngestStore({
        realDataRoot,
        operations: {
          rename: async (from, to) => {
            if (to.endsWith(".json")) {
              throw new Error("blocked");
            }
            await rename(from, to);
          },
        },
      });
      const sha256 = sha256Hex(pdfBytes("A"));

      const failed = await ingest(createRegistry(), failing, supplied("A"), request());

      expect(!failed.ok && failed.error.code).toBe("STORE_WRITE_FAILED");
      expect(await listFiles(realDataRoot)).toEqual([`raw/${rawObjectRelativePath(sha256)}`]);

      const retried = await ingest(createRegistry(), createFileIngestStore({ realDataRoot }), supplied("A"), request());

      expect(retried.ok && retried.value.status).toBe("CREATED");
      expect(await listFiles(realDataRoot)).toHaveLength(2);
    }, "ingest-record-fail");
  });

  it("fails closed on an unreadable or inconsistent store", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const realDataRoot = await createRealDataRoot(base);
      const store = createFileIngestStore({ realDataRoot });
      await mkdir(join(realDataRoot, "ingest", "bulletin-a"), { recursive: true });
      await writeFile(join(realDataRoot, "ingest", "bulletin-a", "r1.json"), "{ not json");

      const corrupt = await ingest(createRegistry(), store, supplied("A"), request());

      expect(!corrupt.ok && corrupt.error.code).toBe("STORE_READ_FAILED");
      expect(await listFiles(realDataRoot)).toEqual(["ingest/bulletin-a/r1.json"]);
    }, "ingest-corrupt");

    await withTemporaryTestDirectory(async (base) => {
      const realDataRoot = await createRealDataRoot(base);
      const store = createFileIngestStore({ realDataRoot });
      await ingest(createRegistry(), store, supplied("A"), request());
      const text = await readFile(join(realDataRoot, "ingest", "bulletin-a", "r1.json"), "utf8");
      await writeFile(join(realDataRoot, "ingest", "bulletin-a", "r3.json"), text);
      const filesBefore = await listFiles(realDataRoot);

      const gap = await ingest(createRegistry(), store, supplied("B"), request());

      expect(!gap.ok && gap.error.code).toBe("STORE_READ_FAILED");
      expect(await listFiles(realDataRoot)).toEqual(filesBefore);
    }, "ingest-gap");
  });

  it("never logs or returns the document body", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const spies = [
        vi.spyOn(console, "log"),
        vi.spyOn(console, "error"),
        vi.spyOn(console, "warn"),
        vi.spyOn(console, "info"),
      ];
      const realDataRoot = await createRealDataRoot(base);
      const store = createFileIngestStore({ realDataRoot });
      const registry = createRegistry();

      const results = [
        await ingest(registry, store, supplied("A"), request()),
        await ingest(registry, store, supplied("A"), request({ sourceId: "bulletin-copy" })),
        await ingest(registry, store, supplied("A"), request({ electionId: "no-such-election" })),
        await ingest(registry, store, supplied("A", { officialUrl: "" }), request({ sourceId: "other-a" })),
      ];

      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
      for (const result of results) {
        if (!result.ok) {
          expect(JSON.stringify(result.error)).not.toContain(MARKER);
        }
      }
    }, "ingest-no-log");
  });
});

describe("manual placement supplier", () => {
  async function withRaw<T>(run: (rawDirectory: string) => Promise<T>): Promise<T> {
    return withTemporaryTestDirectory(async (base) => {
      const rawDirectory = join(base, "raw");
      await mkdir(rawDirectory);
      return run(rawDirectory);
    }, "manual-supplier");
  }

  it("returns the body with the stated URL and time", async () => {
    await withRaw(async (rawDirectory) => {
      await writeFile(join(rawDirectory, "bulletin.pdf"), pdfBytes("A"));
      const supplier = createManualPlacementSupplier({ rawDirectory, officialUrl: ` ${OFFICIAL_URL} `, retrievedAt: RETRIEVED_AT });

      const result = await supplier.supply("bulletin.pdf");

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.value.officialUrl).toBe(OFFICIAL_URL);
      expect(result.value.retrievedAt).toBe(RETRIEVED_AT);
      expect(sha256Hex(result.value.bytes)).toBe(sha256Hex(pdfBytes("A")));
    });
  });

  it("uses the injected clock when no retrieval time is given", async () => {
    await withRaw(async (rawDirectory) => {
      await writeFile(join(rawDirectory, "bulletin.pdf"), pdfBytes("A"));
      const supplier = createManualPlacementSupplier({
        rawDirectory,
        officialUrl: OFFICIAL_URL,
        now: () => new Date("2026-11-08T03:04:05.000Z"),
      });

      const result = await supplier.supply("bulletin.pdf");

      expect(result.ok && result.value.retrievedAt).toBe("2026-11-08T03:04:05.000Z");
    });
  });

  it.each(["", "../x.pdf", "a/b.pdf", "a\\b.pdf", "C:x.pdf", ".hidden.pdf", "a..b.pdf", " a.pdf", "con.pdf", "nul.pdf", "aux.PDF", "a*.pdf"])(
    "rejects the unsafe file name %j",
    async (name) => {
      await withRaw(async (rawDirectory) => {
        const supplier = createManualPlacementSupplier({ rawDirectory, officialUrl: OFFICIAL_URL, retrievedAt: RETRIEVED_AT });

        const result = await supplier.supply(name);

        expect(!result.ok && result.error.code).toBe("FILE_NAME_INVALID");
      });
    },
  );

  it("accepts only PDF names", async () => {
    await withRaw(async (rawDirectory) => {
      await writeFile(join(rawDirectory, "notes.txt"), "text");
      const supplier = createManualPlacementSupplier({ rawDirectory, officialUrl: OFFICIAL_URL, retrievedAt: RETRIEVED_AT });

      const result = await supplier.supply("notes.txt");

      expect(!result.ok && result.error.code).toBe("UNSUPPORTED_FILE_TYPE");
    });
  });

  it("reports a missing file and a directory named like a PDF", async () => {
    await withRaw(async (rawDirectory) => {
      await mkdir(join(rawDirectory, "folder.pdf"));
      const supplier = createManualPlacementSupplier({ rawDirectory, officialUrl: OFFICIAL_URL, retrievedAt: RETRIEVED_AT });

      const missing = await supplier.supply("missing.pdf");
      const directory = await supplier.supply("folder.pdf");

      expect(!missing.ok && missing.error.code).toBe("FILE_NOT_FOUND");
      expect(!directory.ok && directory.error.code).toBe("FILE_UNREADABLE");
      expect(JSON.stringify(!missing.ok ? missing.error : {})).not.toContain(rawDirectory);
    });
  });

  it("requires a valid official URL and retrieval time before reading anything", async () => {
    await withRaw(async (rawDirectory) => {
      const noUrl = createManualPlacementSupplier({ rawDirectory, retrievedAt: RETRIEVED_AT });
      const badBoth = createManualPlacementSupplier({ rawDirectory, officialUrl: "http://example.test/a.pdf", retrievedAt: "yesterday" });

      const first = await noUrl.supply("missing.pdf");
      const second = await badBoth.supply("missing.pdf");

      expect(!first.ok && first.error.code).toBe("SUPPLY_INCOMPLETE");
      expect(!first.ok && first.error.fields).toEqual(["officialUrl"]);
      expect(!second.ok && second.error.fields).toEqual(["officialUrl", "retrievedAt"]);
    });
  });
});

describe("toManifestDraft", () => {
  const developerInput = {
    issuer: "Test Issuer",
    title: "Test Bulletin",
    sourceType: "election-bulletin",
    publishedAt: "2026-11-01",
    usage: {
      status: "UNKNOWN",
      checkedAt: "2026-11-08",
      checkedTarget: "test target",
      evidence: "test evidence",
    },
    electionCorrespondenceEvidence: "test correspondence",
    adoptionRuleVersion: "test-v1",
    adoptionDecision: "EXCLUDED",
    adoptionReason: "test reason",
  };

  it("builds a Source Manifest record from the ingest record and the developer's items", () => {
    const record = recordFor({ assignment: { state: "ASSIGNED", candidateId: CANDIDATE_ID } });

    const result = toManifestDraft(record, developerInput);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(SourceManifestRecordSchema.safeParse(result.value).success).toBe(true);
    expect(result.value).toMatchObject({
      dataKind: "REAL_AI",
      sourceId: "bulletin-a",
      revision: "r1",
      electionId: ELECTION_ID,
      candidateId: CANDIDATE_ID,
      reference: { kind: "url", url: OFFICIAL_URL },
      rawSnapshotRelativePath: record.rawSnapshotRelativePath,
      sourceChecksum: record.sha256,
      retrievedAt: "2026-11-08",
      adoptionDecision: "EXCLUDED",
    });
  });

  it("uses a null candidate for shared or unassigned documents and the Japan date for the retrieval day", () => {
    const record = recordFor({ assignment: { state: "SHARED" }, retrievedAt: "2026-11-08T20:00:00.000Z" });

    const result = toManifestDraft(record, developerInput);

    expect(result.ok && result.value.candidateId).toBeNull();
    expect(result.ok && result.value.retrievedAt).toBe("2026-11-09");
  });

  it("never fills in missing items and names them without their values", () => {
    const result = toManifestDraft(recordFor(), {});

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.fields).toEqual(
      expect.arrayContaining(["issuer", "title", "sourceType", "publishedAt", "usage", "electionCorrespondenceEvidence", "adoptionRuleVersion", "adoptionDecision", "adoptionReason"]),
    );
  });

  it("rejects an unknown source type", () => {
    const result = toManifestDraft(recordFor(), { ...developerInput, sourceType: "guess" });

    expect(!result.ok && result.error.fields).toEqual(["sourceType"]);
  });
});