import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { withTemporaryTestDirectory } from "../../../../tests/harness/temporary-directory.js";
import { REGISTRY_RELATIVE_PATH } from "../election/registryFile.js";
import { runAnalysisCli } from "./cli.js";

const OLD_ID = "test-election-old";
const NEW_ID = "test-election-new";

// Obviously fictional placeholders; no real 2026 candidate is registered here.
function registryData() {
  return {
    schemaVersion: 1,
    elections: [
      {
        electionId: OLD_ID,
        name: "Test Election Old",
        electionDate: "2022-11-20",
        status: "CURRENT",
        candidates: [
          { candidateId: "candidate-a", name: "Test Candidate A", nameForms: ["Test Candidate A"] },
        ],
      },
      {
        electionId: NEW_ID,
        name: "Test Election New",
        electionDate: "2026-11-15",
        status: "PLANNED",
        candidates: [
          { candidateId: "candidate-c", name: "Test Candidate C", nameForms: ["Test Candidate C"] },
        ],
      },
    ],
  };
}

async function createWorkspace(base: string, data: unknown = registryData()): Promise<{ path: string; root: string }> {
  const root = join(base, "workspace");
  const path = join(root, ...REGISTRY_RELATIVE_PATH.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  return { path, root };
}

function createIo(answer: boolean) {
  const lines: string[] = [];
  const questions: string[] = [];
  return {
    lines,
    questions,
    io: {
      write: (line: string) => {
        lines.push(line);
      },
      confirm: async (question: string) => {
        questions.push(question);
        return answer;
      },
    },
  };
}

describe("analysis CLI: election show", () => {
  it("lists every registered election and exits 0", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const { root } = await createWorkspace(base);
      const { io, lines } = createIo(false);

      const code = await runAnalysisCli(["election", "show"], { workspaceRoot: root, io });

      expect(code).toBe(0);
      expect(lines).toEqual([
        "CURRENT test-election-old 2022-11-20 candidates=1 Test Election Old",
        "PLANNED test-election-new 2026-11-15 candidates=1 Test Election New",
      ]);
    }, "cli-show");
  });

  it("reports a missing registry and exits 1", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const { io, lines } = createIo(false);

      const code = await runAnalysisCli(["election", "show"], { workspaceRoot: base, io });

      expect(code).toBe(1);
      expect(lines[0]).toBe("Election registry error: REGISTRY_FILE_MISSING");
      expect(lines.join("\n")).not.toContain(base);
    }, "cli-show-missing");
  });

  it("names every violation of an invalid registry", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const data = registryData();
      const { root } = await createWorkspace(base, {
        ...data,
        elections: data.elections.map((election) => ({ ...election, status: "CURRENT" })),
      });
      const { io, lines } = createIo(false);

      const code = await runAnalysisCli(["election", "show"], { workspaceRoot: root, io });

      expect(code).toBe(1);
      expect(lines).toContain("Election registry error: REGISTRY_CONFIG_INVALID");
      expect(lines).toContain("  violation: INVALID_CURRENT_COUNT");
    }, "cli-show-invalid");
  });
});

describe("analysis CLI: election change", () => {
  it("shows before and after, asks once, and saves only after approval", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const { path, root } = await createWorkspace(base);
      const { io, lines, questions } = createIo(true);

      const code = await runAnalysisCli(["election", "change", NEW_ID], { workspaceRoot: root, io });

      expect(code).toBe(0);
      expect(questions).toHaveLength(1);
      expect(lines).toContain(`Current election : ${OLD_ID} Test Election Old`);
      expect(lines).toContain(`Proposed election: ${NEW_ID} Test Election New`);
      expect(lines.at(-1)).toBe("The current election was changed and saved.");
      const saved = JSON.parse(await readFile(path, "utf8")) as {
        elections: Array<{ electionId: string; status: string }>;
      };
      expect(saved.elections.map((e) => [e.electionId, e.status])).toEqual([
        [OLD_ID, "PAST"],
        [NEW_ID, "CURRENT"],
      ]);
    }, "cli-change-approve");
  });

  it("does not save when the change is declined", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const { path, root } = await createWorkspace(base);
      const before = await readFile(path);
      const { io, lines, questions } = createIo(false);

      const code = await runAnalysisCli(["election", "change", NEW_ID], { workspaceRoot: root, io });

      expect(code).toBe(1);
      expect(questions).toHaveLength(1);
      expect(lines).toContain("Not changed: REJECTED");
      expect((await readFile(path)).equals(before)).toBe(true);
    }, "cli-change-decline");
  });

  it.each([
    ["an unknown election", "no-such-election"],
    ["the election that is already current", OLD_ID],
  ])("refuses %s without asking or saving", async (_label, target) => {
    await withTemporaryTestDirectory(async (base) => {
      const { path, root } = await createWorkspace(base);
      const before = await readFile(path);
      const { io, lines, questions } = createIo(true);

      const code = await runAnalysisCli(["election", "change", target], { workspaceRoot: root, io });

      expect(code).toBe(1);
      expect(questions).toHaveLength(0);
      expect(lines).toContain("Not changed: TARGET_INVALID");
      expect((await readFile(path)).equals(before)).toBe(true);
    }, "cli-change-invalid");
  });

  it("keeps the original file when saving fails and does not leak paths", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const { path, root } = await createWorkspace(base);
      const before = await readFile(path);
      const { io, lines } = createIo(true);

      const code = await runAnalysisCli(["election", "change", NEW_ID], {
        workspaceRoot: root,
        io,
        registry: {
          operations: {
            rename: async () => {
              throw new Error(`blocked ${root}`);
            },
          },
        },
      });

      expect(code).toBe(1);
      expect(lines).toContain("Not changed: UPDATE_FAILED");
      expect(lines.join("\n")).not.toContain(root);
      expect((await readFile(path)).equals(before)).toBe(true);
      expect(await readdir(dirname(path))).toEqual(["elections.json"]);
    }, "cli-change-save-fails");
  });
});

describe("analysis CLI: usage", () => {
  it.each([
    [[]],
    [["election"]],
    [["election", "show", "extra"]],
    [["election", "change"]],
    [["election", "change", "a", "b"]],
    [["unknown"]],
  ])("prints the usage and exits 1 for %j", async (argv) => {
    await withTemporaryTestDirectory(async (base) => {
      const { io, lines, questions } = createIo(true);

      const code = await runAnalysisCli(argv, { workspaceRoot: base, io });

      expect(code).toBe(1);
      expect(lines[0]).toBe("Usage: npm run analysis -- <command>");
      expect(questions).toHaveLength(0);
    }, "cli-usage");
  });
});