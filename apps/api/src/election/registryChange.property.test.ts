import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createTemporaryTestDirectory } from "../../../../tests/harness/temporary-directory.js";
import { REGISTRY_RELATIVE_PATH, applyElectionChange, readRegistryFile } from "./registryFile.js";

const RUNS = 100;
const IDS = ["election-a", "election-b", "election-c"] as const;

type Operation = {
  target: string;
  confirm: "yes" | "no" | "throw";
  failWrite: boolean;
};

const operationArb: fc.Arbitrary<Operation> = fc.record({
  target: fc.constantFrom(...IDS, "no-such-election"),
  confirm: fc.constantFrom<"yes" | "no" | "throw">("yes", "yes", "no", "throw"),
  failWrite: fc.boolean(),
});

// Obviously fictional placeholders; no real candidate appears here.
function registryData(statuses: Record<string, string>) {
  return {
    schemaVersion: 1,
    elections: IDS.map((electionId, index) => ({
      electionId,
      name: `Test Election ${electionId}`,
      electionDate: index === 0 ? "2022-11-20" : "2026-11-15",
      status: statuses[electionId],
      candidates: [
        { candidateId: `candidate-${index}`, name: `Test Candidate ${index}`, nameForms: [`Test Candidate ${index}`] },
      ],
    })),
  };
}

function statusesOnDisk(text: string): Record<string, string> {
  const parsed = JSON.parse(text) as { elections: Array<{ electionId: string; status: string }> };
  return Object.fromEntries(parsed.elections.map((e) => [e.electionId, e.status]));
}

describe("Feature: multi-election-ai-analysis, Property 2: election change keeps the saved registry intact", () => {
  it("saves only approved valid changes and never damages the file when saving fails", async () => {
    let changed = 0;
    let untouched = 0;

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...IDS),
        fc.array(operationArb, { minLength: 1, maxLength: 6 }),
        async (startId, operations) => {
          const directory = await createTemporaryTestDirectory("registry-change");
          try {
            const root = join(directory.path, "workspace");
            const path = join(root, ...REGISTRY_RELATIVE_PATH.split("/"));
            await mkdir(dirname(path), { recursive: true });
            const model: Record<string, string> = {};
            IDS.forEach((id, index) => {
              model[id] = id === startId ? "CURRENT" : index % 2 === 0 ? "PAST" : "PLANNED";
            });
            await writeFile(path, `${JSON.stringify(registryData(model), null, 2)}\n`);

            for (const operation of operations) {
              const before = await readFile(path);
              let confirmCalls = 0;
              const targetIsValid = (IDS as readonly string[]).includes(operation.target) && model[operation.target] !== "CURRENT";

              const outcome = await applyElectionChange({
                workspaceRoot: root,
                toElectionId: operation.target,
                confirm: async () => {
                  confirmCalls += 1;
                  if (operation.confirm === "throw") {
                    throw new Error("terminal closed");
                  }
                  return operation.confirm === "yes";
                },
                ...(operation.failWrite
                  ? { operations: { rename: async () => { throw new Error("rename blocked"); } } }
                  : {}),
              });

              if (!targetIsValid) {
                expect(outcome.status === "NOT_CHANGED" && outcome.reason).toBe("TARGET_INVALID");
                expect(confirmCalls).toBe(0);
              } else if (operation.confirm !== "yes") {
                expect(outcome.status === "NOT_CHANGED" && outcome.reason).toBe("REJECTED");
                expect(confirmCalls).toBe(1);
              } else if (operation.failWrite) {
                expect(outcome.status === "NOT_CHANGED" && outcome.reason).toBe("UPDATE_FAILED");
              } else {
                expect(outcome.status).toBe("CHANGED");
              }

              if (outcome.status === "CHANGED") {
                changed += 1;
                const oldCurrent = Object.keys(model).find((id) => model[id] === "CURRENT");
                if (oldCurrent !== undefined) {
                  model[oldCurrent] = "PAST";
                }
                model[operation.target] = "CURRENT";
              } else {
                untouched += 1;
                expect((await readFile(path)).equals(before)).toBe(true);
              }

              expect(statusesOnDisk(await readFile(path, "utf8"))).toEqual(model);
              const reread = await readRegistryFile({ workspaceRoot: root });
              expect(reread.ok).toBe(true);
              expect(reread.ok && reread.value.elections.filter((e) => e.status === "CURRENT")).toHaveLength(1);
              expect(await readdir(dirname(path))).toEqual(["elections.json"]);
            }
          } finally {
            await directory.cleanup();
          }
        },
      ),
      { numRuns: RUNS },
    );

    expect(changed).toBeGreaterThan(0);
    expect(untouched).toBeGreaterThan(0);
  });
});