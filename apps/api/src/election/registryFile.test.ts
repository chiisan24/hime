import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CandidateSchema,
  TARGET_ELECTION_ID,
  TARGET_ELECTION_NAME,
} from "@ehime-vote-navigator/contracts";
import { loadRegistry, type ChangeProposal } from "@ehime-vote-navigator/domain";
import { describe, expect, it } from "vitest";

import { withTemporaryTestDirectory } from "../../../../tests/harness/temporary-directory.js";
import {
  REGISTRY_RELATIVE_PATH,
  applyElectionChange,
  readRegistryFile,
  serializeRegistry,
  writeRegistryFile,
} from "./registryFile.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const OLD_ID = "test-election-old";
const OLD_NAME = "Test Election Old";
const NEW_ID = "test-election-new";
const NEW_NAME = "Test Election New";

// Obviously fictional placeholders; no real 2026 candidate is registered here.
function registryData(statuses: readonly [string, string] = ["CURRENT", "PLANNED"]) {
  return {
    schemaVersion: 1,
    elections: [
      {
        electionId: OLD_ID,
        name: OLD_NAME,
        electionDate: "2022-11-20",
        status: statuses[0],
        candidates: [
          {
            candidateId: "candidate-a",
            name: "Test Candidate A",
            nameForms: ["Test Candidate A"],
          },
        ],
      },
      {
        electionId: NEW_ID,
        name: NEW_NAME,
        electionDate: "2026-11-15",
        status: statuses[1],
        candidates: [
          {
            candidateId: "candidate-c",
            name: "Test Candidate C",
            nameForms: ["Test Candidate C", "Test C"],
          },
        ],
      },
    ],
  };
}

async function createWorkspace(base: string): Promise<string> {
  const root = join(base, "workspace");
  await mkdir(root);
  return root;
}

async function seedRegistry(root: string, data: unknown = registryData()): Promise<string> {
  const path = join(root, ...REGISTRY_RELATIVE_PATH.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
}

async function expectOnlyRegistry(root: string): Promise<void> {
  expect(await readdir(join(root, "config", "election"))).toEqual([
    "elections.json",
  ]);
}

function statusesOf(text: string): string[][] {
  const parsed = JSON.parse(text) as {
    elections: Array<{ electionId: string; status: string }>;
  };
  return parsed.elections.map((election) => [election.electionId, election.status]);
}

function createConfirm(answer: boolean) {
  const proposals: ChangeProposal[] = [];
  return {
    proposals,
    confirm: async (proposal: ChangeProposal) => {
      proposals.push(proposal);
      return answer;
    },
  };
}

const BLOCKED_RENAME = {
  rename: async () => {
    throw new Error("rename blocked");
  },
};

describe("readRegistryFile", () => {
  it("reads the tracked registry and keeps the existing 2022 election values", async () => {
    const loaded = await readRegistryFile({ workspaceRoot: REPOSITORY_ROOT });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const election = loaded.value.elections.find(
      (candidate) => candidate.electionId === TARGET_ELECTION_ID,
    );

    expect(election?.name).toBe(TARGET_ELECTION_NAME);
    expect(election?.electionDate).toBe("2022-11-20");
    expect(election?.candidates.map((candidate) => candidate.name)).toEqual([
      ...CandidateSchema.shape.canonicalName.options,
    ]);
    expect(election?.candidates.map((candidate) => candidate.candidateId)).toEqual([
      "nakamura-tokihiro",
      "hayashi-noriko",
    ]);
    for (const candidate of election?.candidates ?? []) {
      expect(candidate.nameForms).toContain(candidate.name);
    }
    expect(election?.candidates[1]?.nameForms).toContain("\u6797\u306e\u308a\u3053");
    expect(
      loaded.value.elections.filter((candidate) => candidate.status === "CURRENT"),
    ).toHaveLength(1);
  });

  it("reads a registry that adds a placeholder 2026 PLANNED election", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      await seedRegistry(root);

      const loaded = await readRegistryFile({ workspaceRoot: root });

      expect(loaded.ok).toBe(true);
      if (!loaded.ok) {
        return;
      }
      expect(loaded.value.elections.map((e) => [e.electionId, e.status, e.electionDate])).toEqual([
        [OLD_ID, "CURRENT", "2022-11-20"],
        [NEW_ID, "PLANNED", "2026-11-15"],
      ]);
    }, "registry-read");
  });

  it("reports a missing file", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);

      const loaded = await readRegistryFile({ workspaceRoot: root });

      expect(loaded.ok).toBe(false);
      expect(!loaded.ok && loaded.error.code).toBe("REGISTRY_FILE_MISSING");
    }, "registry-missing");
  });

  it("reports an unreadable file without exposing the path", async () => {
    const loaded = await readRegistryFile({
      workspaceRoot: REPOSITORY_ROOT,
      readFile: async () => {
        throw Object.assign(new Error(`denied ${REPOSITORY_ROOT}`), { code: "EACCES" });
      },
    });

    expect(loaded.ok).toBe(false);
    if (loaded.ok) {
      return;
    }
    expect(loaded.error.code).toBe("REGISTRY_FILE_UNREADABLE");
    expect(JSON.stringify(loaded.error)).not.toContain(REPOSITORY_ROOT);
  });

  it("reports invalid JSON", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const path = await seedRegistry(root);
      await writeFile(path, "{ not json");

      const loaded = await readRegistryFile({ workspaceRoot: root });

      expect(!loaded.ok && loaded.error.code).toBe("REGISTRY_JSON_INVALID");
    }, "registry-bad-json");
  });

  it("accepts a UTF-8 byte order mark", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const path = await seedRegistry(root);
      await writeFile(path, `\uFEFF${JSON.stringify(registryData())}`);

      const loaded = await readRegistryFile({ workspaceRoot: root });

      expect(loaded.ok).toBe(true);
    }, "registry-bom");
  });

  it("validates with the registry contract and returns every violation kind", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const data = registryData(["CURRENT", "CURRENT"]);
      await seedRegistry(root, {
        ...data,
        elections: data.elections.map((election) => ({ ...election, timeZone: "x" })),
      });

      const loaded = await readRegistryFile({ workspaceRoot: root });

      expect(loaded.ok).toBe(false);
      if (loaded.ok || loaded.error.code !== "REGISTRY_CONFIG_INVALID") {
        throw new Error("Expected a registry contract error.");
      }
      expect(loaded.error.violations).toEqual([
        "CONTRACT_VIOLATION",
        "INVALID_CURRENT_COUNT",
      ]);
    }, "registry-invalid");
  });
});

describe("serializeRegistry and writeRegistryFile", () => {
  it("round-trips through the registry contract with a trailing newline", async () => {
    const loaded = loadRegistry(registryData());
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const text = new TextDecoder().decode(serializeRegistry(loaded.value));

    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(registryData());
    expect(loadRegistry(JSON.parse(text)).ok).toBe(true);
  });

  it("creates the registry file when none exists and replaces it afterwards", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const loaded = loadRegistry(registryData());
      if (!loaded.ok) {
        throw new Error("fixture registry invalid");
      }

      const first = await writeRegistryFile({ workspaceRoot: root, registry: loaded.value });
      const second = await writeRegistryFile({ workspaceRoot: root, registry: loaded.value });

      expect(first.ok && first.value.state).toBe("created");
      expect(second.ok && second.value.state).toBe("replaced");
      await expectOnlyRegistry(root);
    }, "registry-write");
  });

  it("reports UPDATE_FAILED and keeps the original file when the save fails", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const path = await seedRegistry(root);
      const before = await readFile(path);
      const loaded = loadRegistry(registryData(["PAST", "CURRENT"]));
      if (!loaded.ok) {
        throw new Error("fixture registry invalid");
      }

      const written = await writeRegistryFile({
        workspaceRoot: root,
        registry: loaded.value,
        operations: BLOCKED_RENAME,
      });

      expect(written.ok).toBe(false);
      if (written.ok) {
        return;
      }
      expect(written.error.code).toBe("UPDATE_FAILED");
      expect(written.error.storageCode).toBe("ATOMIC_RENAME_FAILED");
      expect(JSON.stringify(written.error)).not.toContain(root);
      expect((await readFile(path)).equals(before)).toBe(true);
      await expectOnlyRegistry(root);
    }, "registry-write-fail");
  });
});

describe("applyElectionChange", () => {
  it("saves the change only after approval and changes nothing but the two statuses", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const path = await seedRegistry(root);
      const { confirm, proposals } = createConfirm(true);

      const outcome = await applyElectionChange({
        workspaceRoot: root,
        toElectionId: NEW_ID,
        confirm,
      });

      expect(outcome.status).toBe("CHANGED");
      expect(proposals).toEqual([
        {
          from: { electionId: OLD_ID, name: OLD_NAME },
          to: { electionId: NEW_ID, name: NEW_NAME },
        },
      ]);
      const text = await readFile(path, "utf8");
      expect(statusesOf(text)).toEqual([
        [OLD_ID, "PAST"],
        [NEW_ID, "CURRENT"],
      ]);
      expect(JSON.parse(text)).toEqual(registryData(["PAST", "CURRENT"]));
      await expectOnlyRegistry(root);
      expect((await readRegistryFile({ workspaceRoot: root })).ok).toBe(true);
    }, "change-approve");
  });

  it("does not save when the change is not approved", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const path = await seedRegistry(root);
      const before = await readFile(path);
      const { confirm, proposals } = createConfirm(false);

      const outcome = await applyElectionChange({
        workspaceRoot: root,
        toElectionId: NEW_ID,
        confirm,
      });

      expect(outcome.status).toBe("NOT_CHANGED");
      expect(outcome.status === "NOT_CHANGED" && outcome.reason).toBe("REJECTED");
      expect(proposals).toHaveLength(1);
      expect((await readFile(path)).equals(before)).toBe(true);
      await expectOnlyRegistry(root);
    }, "change-reject");
  });

  it("treats a failing confirmation as not approved", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const path = await seedRegistry(root);
      const before = await readFile(path);

      const outcome = await applyElectionChange({
        workspaceRoot: root,
        toElectionId: NEW_ID,
        confirm: async () => {
          throw new Error("terminal closed");
        },
      });

      expect(outcome.status === "NOT_CHANGED" && outcome.reason).toBe("REJECTED");
      expect((await readFile(path)).equals(before)).toBe(true);
    }, "change-confirm-throws");
  });

  it.each([
    ["an unregistered election", "no-such-election"],
    ["the election that is already current", OLD_ID],
  ])("rejects %s without asking for approval or writing", async (_label, target) => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const path = await seedRegistry(root);
      const before = await readFile(path);
      const { confirm, proposals } = createConfirm(true);

      const outcome = await applyElectionChange({
        workspaceRoot: root,
        toElectionId: target,
        confirm,
      });

      expect(outcome.status === "NOT_CHANGED" && outcome.reason).toBe("TARGET_INVALID");
      expect(proposals).toHaveLength(0);
      expect((await readFile(path)).equals(before)).toBe(true);
    }, "change-invalid-target");
  });

  it("reports UPDATE_FAILED and leaves the original registry intact when saving fails", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const path = await seedRegistry(root);
      const before = await readFile(path);
      const { confirm, proposals } = createConfirm(true);

      const outcome = await applyElectionChange({
        workspaceRoot: root,
        toElectionId: NEW_ID,
        confirm,
        operations: BLOCKED_RENAME,
      });

      expect(outcome.status === "NOT_CHANGED" && outcome.reason).toBe("UPDATE_FAILED");
      expect(proposals).toHaveLength(1);
      expect((await readFile(path)).equals(before)).toBe(true);
      await expectOnlyRegistry(root);
      expect(statusesOf(await readFile(path, "utf8"))).toEqual([
        [OLD_ID, "CURRENT"],
        [NEW_ID, "PLANNED"],
      ]);
    }, "change-save-fails");
  });

  it("does nothing when the registry on disk is invalid", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const path = await seedRegistry(root, registryData(["PAST", "PLANNED"]));
      const before = await readFile(path);
      const { confirm, proposals } = createConfirm(true);

      const outcome = await applyElectionChange({
        workspaceRoot: root,
        toElectionId: NEW_ID,
        confirm,
      });

      expect(outcome.status).toBe("CONFIG_ERROR");
      expect(proposals).toHaveLength(0);
      expect((await readFile(path)).equals(before)).toBe(true);
    }, "change-config-error");
  });

  it("does not create a registry file when none exists", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createWorkspace(base);
      const { confirm, proposals } = createConfirm(true);

      const outcome = await applyElectionChange({
        workspaceRoot: root,
        toElectionId: NEW_ID,
        confirm,
      });

      expect(outcome.status).toBe("CONFIG_ERROR");
      expect(proposals).toHaveLength(0);
      expect(await readdir(root)).toEqual([]);
    }, "change-no-file");
  });
});