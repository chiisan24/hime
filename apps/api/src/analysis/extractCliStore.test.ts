import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { sha256Hex } from "@ehime-vote-navigator/domain";
import { describe, expect, it } from "vitest";

import { withTemporaryTestDirectory } from "../../../../tests/harness/temporary-directory.js";
import { REGISTRY_RELATIVE_PATH } from "../election/registryFile.js";
import { createFileStageStore } from "./stageStore.js";
import { loadStoredExtraction } from "../extract/storedExtraction.js";
import type { PdfTextExtractor } from "../extract/pdfTextExtractor.js";
import { runAnalysisCli } from "./cli.js";

const ELECTION_ID = "test-election-a";
const OFFICIAL_URL = "https://example.test/official/bulletin.pdf";
const RETRIEVED_AT = "2026-11-08T03:04:05.000Z";
const BYTES_MARKER = "RAW-PDF-BYTES-MARKER";
const BODY = new TextEncoder().encode(`%PDF-1.4\n% ${BYTES_MARKER}\n%%EOF\n`);
const SHA = sha256Hex(BODY);

async function createWorkspace(base: string): Promise<string> {
  const root = join(base, "workspace");
  await mkdir(join(root, "data", "real", "raw"), { recursive: true });
  await writeFile(join(root, "data", "real", "raw", "bulletin.pdf"), BODY);
  const path = join(root, ...REGISTRY_RELATIVE_PATH.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      elections: [
        {
          electionId: ELECTION_ID,
          name: "Test Election A",
          electionDate: "2026-11-15",
          status: "CURRENT",
          candidates: [{ candidateId: "candidate-a", name: "Test Candidate A", nameForms: ["Test Candidate A"] }],
        },
      ],
    }),
  );
  return root;
}

function createIo() {
  const lines: string[] = [];
  return {
    lines,
    io: { write: (line: string) => { lines.push(line); }, confirm: async () => false },
  };
}

function fakeExtractor(pages: readonly string[]): PdfTextExtractor & { calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    extract: async () => {
      calls += 1;
      return { ok: true, value: pages };
    },
  };
}

async function ingestFirst(root: string): Promise<void> {
  const { io } = createIo();
  const code = await runAnalysisCli(
    ["ingest", "bulletin.pdf", "--election", ELECTION_ID, "--source", "bulletin-a", "--url", OFFICIAL_URL, "--retrieved-at", RETRIEVED_AT, "--shared"],
    { workspaceRoot: root, io },
  );
  expect(code).toBe(0);
}

describe("analysis CLI: extract keeps its result", () => {
  it("saves the EXTRACT run under the SHA-256 and revision of the ingest record", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await ingestFirst(root);
      const { io } = createIo();

      const code = await runAnalysisCli(["extract", "--source", "bulletin-a", "--revision", "r1"], {
        workspaceRoot: root,
        io,
        extractor: fakeExtractor(["First page.", "Test Candidate A describes a plan."]),
      });

      expect(code).toBe(0);
      const record = JSON.parse(
        await readFile(join(root, "data", "real", "ingest", "bulletin-a", "r1.json"), "utf8"),
      ) as { revision: string; sha256: string };
      expect(record).toMatchObject({ revision: "r1", sha256: SHA });
      const loaded = await loadStoredExtraction(createFileStageStore({ realDataRoot: join(root, "data", "real") }), {
        revision: record.revision,
        sourceSha256: record.sha256,
      });
      expect(loaded.ok && loaded.value?.pages.map((page) => page.page)).toEqual([1, 2]);
      expect(loaded.ok && loaded.value?.passages.some((passage) => passage.assignment.state === "ASSIGNED")).toBe(true);
    }, "extract-store-save");
  });

  it("serves a second extract from the store and keeps the original PDF unchanged", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await ingestFirst(root);
      const extractor = fakeExtractor(["Some text."]);
      const first = createIo();
      const second = createIo();

      await runAnalysisCli(["extract", "--source", "bulletin-a"], { workspaceRoot: root, io: first.io, extractor });
      await runAnalysisCli(["extract", "--source", "bulletin-a"], { workspaceRoot: root, io: second.io, extractor });

      expect(first.lines.at(-1)).toMatch(/cached=false$/u);
      expect(second.lines.at(-1)).toMatch(/cached=true$/u);
      expect(extractor.calls()).toBe(1);
      expect(await readdir(join(root, "data", "real", "stages", SHA, "r1", "EXTRACT"))).toHaveLength(1);
      expect(sha256Hex(await readFile(join(root, "data", "real", "raw", "bulletin.pdf")))).toBe(SHA);
    }, "extract-store-cache");
  });

  it("stops with STORE_WRITE_FAILED and keeps nothing when the save fails", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await ingestFirst(root);
      const { io, lines } = createIo();

      const code = await runAnalysisCli(["extract", "--source", "bulletin-a"], {
        workspaceRoot: root,
        io,
        extractor: fakeExtractor(["Some text."]),
        stageOperations: { rename: async () => { throw new Error("rename blocked"); } },
      });

      expect(code).toBe(1);
      expect(lines[0]).toBe("Extract rejected: STORE_WRITE_FAILED");
      expect(await readdir(join(root, "data", "real", "stages", SHA, "r1", "EXTRACT"))).toEqual([]);
    }, "extract-store-fail");
  });
});