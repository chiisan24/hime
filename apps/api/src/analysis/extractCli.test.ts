import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { rawObjectRelativePath } from "@ehime-vote-navigator/contracts";
import { sha256Hex } from "@ehime-vote-navigator/domain";
import { describe, expect, it } from "vitest";

import { withTemporaryTestDirectory } from "../../../../tests/harness/temporary-directory.js";
import { REGISTRY_RELATIVE_PATH } from "../election/registryFile.js";
import type { PdfTextExtractor } from "../extract/pdfTextExtractor.js";
import { runAnalysisCli } from "./cli.js";

const ELECTION_ID = "test-election-a";
const OFFICIAL_URL = "https://example.test/official/bulletin.pdf";
const RETRIEVED_AT = "2026-11-08T03:04:05.000Z";
const MARKER = "SECRET-PAGE-TEXT-MARKER";
const BODY = new TextEncoder().encode(`%PDF-1.4\n% placeholder ${MARKER}\n%%EOF\n`);

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
          candidates: [
            { candidateId: "candidate-a", name: "Test Candidate A", nameForms: ["Test Candidate A"] },
            { candidateId: "candidate-b", name: "Test Candidate B", nameForms: ["Test Candidate B"] },
          ],
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

describe("analysis CLI: extract", () => {
  it("reports counts only and never the page text", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await ingestFirst(root);
      const { io, lines } = createIo();
      const extractor = fakeExtractor([`Intro text. ${MARKER}`, "Test Candidate A describes a plan.", "", "Test Candidate A and Test Candidate B."]);

      const code = await runAnalysisCli(["extract", "--source", "bulletin-a", "--revision", "r1"], { workspaceRoot: root, io, extractor });

      expect(code).toBe(0);
      expect(extractor.calls()).toBe(1);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe(
        "Extract COMPLETED: source=bulletin-a revision=r1 pages=4 imagePages=3 passages=3 assigned=1 unassigned=2",
      );
      expect(lines[1]).toMatch(/^Stage saved: stage=EXTRACT stageRunId=[0-9a-f]{12} cached=false$/u);
      expect(lines.join("\n")).not.toContain(MARKER);
      expect(lines.join("\n")).not.toContain(root);
    }, "extract-cli");
  });

  it("uses the latest revision when none is given", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await ingestFirst(root);
      const { io, lines } = createIo();

      const code = await runAnalysisCli(["extract", "--source", "bulletin-a"], { workspaceRoot: root, io, extractor: fakeExtractor(["Some text."]) });

      expect(code).toBe(0);
      expect(lines[0]).toContain("revision=r1");
    }, "extract-cli-latest");
  });

  it("reports NOT_READY with exit code 1 and says OCR is not run", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await ingestFirst(root);
      const { io, lines } = createIo();

      const code = await runAnalysisCli(["extract", "--source", "bulletin-a", "--revision", "r1"], { workspaceRoot: root, io, extractor: fakeExtractor(["", " "]) });

      expect(code).toBe(1);
      expect(lines[0]).toBe("Extract NOT_READY: source=bulletin-a revision=r1 reason=ALL_PAGES_IMAGE pages=2 imagePages=1,2");
      expect(lines).toContain("OCR is not run automatically; human review is needed.");
    }, "extract-cli-not-ready");
  });

  it("refuses to extract when the stored body no longer matches its SHA-256", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await ingestFirst(root);
      const rawPath = join(root, "data", "real", "raw", ...rawObjectRelativePath(sha256Hex(BODY)).split("/"));
      await writeFile(rawPath, new TextEncoder().encode("tampered"));
      const { io, lines } = createIo();
      const extractor = fakeExtractor(["text"]);

      const code = await runAnalysisCli(["extract", "--source", "bulletin-a", "--revision", "r1"], { workspaceRoot: root, io, extractor });

      expect(code).toBe(1);
      expect(lines[0]).toBe("Extract rejected: CHECKSUM_MISMATCH");
      expect(extractor.calls()).toBe(0);
      expect((await readFile(rawPath, "utf8"))).toBe("tampered");
    }, "extract-cli-checksum");
  });

  it.each([
    ["an unknown source", ["extract", "--source", "no-such-source"], "RECORD_NOT_FOUND"],
    ["an unknown revision", ["extract", "--source", "bulletin-a", "--revision", "r9"], "RECORD_NOT_FOUND"],
  ])("rejects %s without calling the extractor", async (_label, argv, code) => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await ingestFirst(root);
      const { io, lines } = createIo();
      const extractor = fakeExtractor(["text"]);

      const exit = await runAnalysisCli(argv, { workspaceRoot: root, io, extractor });

      expect(exit).toBe(1);
      expect(lines[0]).toBe(`Extract rejected: ${code}`);
      expect(extractor.calls()).toBe(0);
    }, "extract-cli-reject");
  });

  it.each([
    [["extract"]],
    [["extract", "--revision", "r1"]],
    [["extract", "--source"]],
    [["extract", "--source", "bulletin-a", "extra"]],
    [["extract", "--source", "bulletin-a", "--unknown", "x"]],
  ])("prints the usage and exits 1 for %j", async (argv) => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { io, lines } = createIo();

      const code = await runAnalysisCli(argv, { workspaceRoot: root, io, extractor: fakeExtractor(["text"]) });

      expect(code).toBe(1);
      expect(lines[0]).toBe("Usage: npm run analysis -- <command>");
    }, "extract-cli-usage");
  });
});