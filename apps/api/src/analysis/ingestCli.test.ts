import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { sha256Hex } from "@ehime-vote-navigator/domain";
import { describe, expect, it } from "vitest";

import { withTemporaryTestDirectory } from "../../../../tests/harness/temporary-directory.js";
import { REGISTRY_RELATIVE_PATH } from "../election/registryFile.js";
import { runAnalysisCli } from "./cli.js";

const ELECTION_ID = "test-election-a";
const OFFICIAL_URL = "https://example.test/official/bulletin.pdf";
const RETRIEVED_AT = "2026-11-08T03:04:05.000Z";
const MARKER = "SECRET-DOCUMENT-TEXT-MARKER";
const BODY = new TextEncoder().encode(`%PDF-1.4\n% ${MARKER}\n%%EOF\n`);

async function createWorkspace(base: string, withRegistry = true): Promise<string> {
  const root = join(base, "workspace");
  await mkdir(join(root, "data", "real", "raw"), { recursive: true });
  await writeFile(join(root, "data", "real", "raw", "bulletin.pdf"), BODY);
  if (withRegistry) {
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
            ],
          },
        ],
      }),
    );
  }
  return root;
}

function createIo() {
  const lines: string[] = [];
  return {
    lines,
    io: {
      write: (line: string) => {
        lines.push(line);
      },
      confirm: async () => false,
    },
  };
}

const BASE_ARGS = ["ingest", "bulletin.pdf", "--election", ELECTION_ID, "--source", "bulletin-a", "--url", OFFICIAL_URL, "--retrieved-at", RETRIEVED_AT];

async function ingestFiles(root: string): Promise<string[]> {
  try {
    return await readdir(join(root, "data", "real", "ingest"), { recursive: true });
  } catch {
    return [];
  }
}

describe("analysis CLI: ingest", () => {
  it("registers a PDF and then reports it as unchanged", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const first = createIo();
      const second = createIo();
      const sha256 = sha256Hex(BODY);

      const created = await runAnalysisCli(BASE_ARGS, { workspaceRoot: root, io: first.io });
      const repeated = await runAnalysisCli(BASE_ARGS, { workspaceRoot: root, io: second.io });

      expect(created).toBe(0);
      expect(first.lines).toEqual([
        `Ingest CREATED: source=bulletin-a revision=r1 election=${ELECTION_ID} assignment=UNASSIGNED sha256=${sha256} bytes=${BODY.byteLength}`,
      ]);
      expect(repeated).toBe(0);
      expect(second.lines[0]).toContain("Ingest UNCHANGED: source=bulletin-a revision=r1");
    }, "ingest-cli");
  });

  it("records an explicit candidate or a shared document", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const assigned = createIo();
      const shared = createIo();

      const first = await runAnalysisCli([...BASE_ARGS, "--candidate", "candidate-a"], { workspaceRoot: root, io: assigned.io });
      const second = await runAnalysisCli(["ingest", "bulletin.pdf", "--election", ELECTION_ID, "--source", "bulletin-b", "--url", OFFICIAL_URL, "--shared"], {
        workspaceRoot: root,
        io: shared.io,
        now: () => new Date(RETRIEVED_AT),
      });

      expect(first).toBe(0);
      expect(assigned.lines[0]).toContain("assignment=ASSIGNED");
      expect(second).toBe(1);
      expect(shared.lines[0]).toBe("Ingest rejected: DUPLICATE_CONTENT");
    }, "ingest-cli-assign");
  });

  it("uses the injected clock when no retrieval time is given", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { io, lines } = createIo();

      const code = await runAnalysisCli(["ingest", "bulletin.pdf", "--election", ELECTION_ID, "--source", "bulletin-a", "--url", OFFICIAL_URL, "--shared"], {
        workspaceRoot: root,
        io,
        now: () => new Date(RETRIEVED_AT),
      });

      expect(code).toBe(0);
      expect(lines[0]).toContain("assignment=SHARED");
      const files = await ingestFiles(root);
      expect(files.some((name) => name.endsWith("r1.json"))).toBe(true);
    }, "ingest-cli-clock");
  });

  it.each([
    ["an unknown election", ["ingest", "bulletin.pdf", "--election", "no-such-election", "--source", "bulletin-a", "--url", OFFICIAL_URL], "UNKNOWN_ELECTION"],
    ["an unknown candidate", [...BASE_ARGS, "--candidate", "candidate-z"], "UNKNOWN_CANDIDATE"],
    ["a missing URL", ["ingest", "bulletin.pdf", "--election", ELECTION_ID, "--source", "bulletin-a"], "SUPPLY_INCOMPLETE"],
    ["a path in the file name", ["ingest", "../secret.pdf", "--election", ELECTION_ID, "--source", "bulletin-a", "--url", OFFICIAL_URL], "FILE_NAME_INVALID"],
    ["a missing file", ["ingest", "missing.pdf", "--election", ELECTION_ID, "--source", "bulletin-a", "--url", OFFICIAL_URL], "FILE_NOT_FOUND"],
    ["a bad source ID", ["ingest", "bulletin.pdf", "--election", ELECTION_ID, "--source", "Bad_ID", "--url", OFFICIAL_URL], "SOURCE_ID_INVALID"],
  ])("rejects %s and saves nothing", async (_label, argv, code) => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { io, lines } = createIo();

      const exit = await runAnalysisCli(argv, { workspaceRoot: root, io, now: () => new Date(RETRIEVED_AT) });

      expect(exit).toBe(1);
      expect(lines[0]).toBe(`Ingest rejected: ${code}`);
      expect(lines).toContain("Nothing was saved.");
      expect(await ingestFiles(root)).toEqual([]);
    }, "ingest-cli-reject");
  });

  it("names the missing item for a missing URL", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { io, lines } = createIo();

      await runAnalysisCli(["ingest", "bulletin.pdf", "--election", ELECTION_ID, "--source", "bulletin-a"], { workspaceRoot: root, io, now: () => new Date(RETRIEVED_AT) });

      expect(lines).toContain("  items: officialUrl");
    }, "ingest-cli-url");
  });

  it("stops on a missing registry", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base, false);
      const { io, lines } = createIo();

      const code = await runAnalysisCli(BASE_ARGS, { workspaceRoot: root, io });

      expect(code).toBe(1);
      expect(lines[0]).toBe("Election registry error: REGISTRY_FILE_MISSING");
      expect(await ingestFiles(root)).toEqual([]);
    }, "ingest-cli-no-registry");
  });

  it("reports a failed save without leaving a record or leaking paths", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { io, lines } = createIo();

      const code = await runAnalysisCli(BASE_ARGS, {
        workspaceRoot: root,
        io,
        ingestOperations: { rename: async () => { throw new Error(`blocked ${root}`); } },
      });

      expect(code).toBe(1);
      expect(lines[0]).toBe("Ingest rejected: STORE_WRITE_FAILED");
      expect(lines.join("\n")).not.toContain(root);
      expect(await ingestFiles(root)).toEqual([]);
    }, "ingest-cli-write-fail");
  });

  it("never prints the document contents or file paths", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { io, lines } = createIo();

      await runAnalysisCli(BASE_ARGS, { workspaceRoot: root, io });
      await runAnalysisCli(["ingest", "../x.pdf", "--election", ELECTION_ID, "--source", "bulletin-a", "--url", OFFICIAL_URL], { workspaceRoot: root, io, now: () => new Date(RETRIEVED_AT) });

      const output = lines.join("\n");
      expect(output).not.toContain(MARKER);
      expect(output).not.toContain(root);
    }, "ingest-cli-output");
  });

  it.each([
    [["ingest"]],
    [["ingest", "bulletin.pdf"]],
    [["ingest", "bulletin.pdf", "--election", ELECTION_ID]],
    [["ingest", "bulletin.pdf", "--election", ELECTION_ID, "--source", "bulletin-a", "--unknown", "x"]],
    [["ingest", "bulletin.pdf", "--election", ELECTION_ID, "--source", "bulletin-a", "--url"]],
    [["ingest", "bulletin.pdf", "--election", ELECTION_ID, "--source", "bulletin-a", "--candidate", "candidate-a", "--shared"]],
    [["ingest", "a.pdf", "b.pdf", "--election", ELECTION_ID, "--source", "bulletin-a"]],
  ])("prints the usage and exits 1 for %j", async (argv) => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { io, lines } = createIo();

      const code = await runAnalysisCli(argv, { workspaceRoot: root, io });

      expect(code).toBe(1);
      expect(lines[0]).toBe("Usage: npm run analysis -- <command>");
      expect(await ingestFiles(root)).toEqual([]);
    }, "ingest-cli-usage");
  });
});