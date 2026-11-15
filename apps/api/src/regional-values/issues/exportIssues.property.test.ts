import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { FIXTURE_FACTS } from "../../../../../tests/harness/regional-values/draftSupport.js";
import { createIssueWorld, fixtureIssue, ISSUE_SETTINGS } from "../../../../../tests/harness/regional-values/issueSupport.js";
import type { IssueWorld } from "../../../../../tests/harness/regional-values/issueSupport.js";
import { DEFAULT_EXPORT_OPERATIONS, runIssuesExport, verifyOutput } from "./exportIssues.js";
import type { ExportFileOperations } from "./exportIssues.js";
import { loadIssueSnapshot } from "./loadIssueSnapshot.js";

// Feature: regional-values-map, Property 61: the output of issues export and the state record that makes a stale or a failed
// output unusable. The records are fictional. The workspace is a temporary directory.

const PARAMETERS = { seed: 610_061, numRuns: 25 };
const GENERATED_AT = "2026-01-04T09:00:00Z";
const OUTPUT = ["dist", "regional-values", "issues", "fixture"] as const;

type Step = "STATE_WRITE_1" | "FILE_WRITE" | "STATE_WRITE_2" | "DELETE";

/** The operations of the files, with one step that fails. A write is counted from 1: the state RUNNING, then the file, then the state. */
function failingAt(step: Step): ExportFileOperations {
  const failingWrite = { STATE_WRITE_1: 1, FILE_WRITE: 2, STATE_WRITE_2: 3 } as const;
  let writes = 0;
  return {
    ...DEFAULT_EXPORT_OPERATIONS,
    replace: async (workspaceRoot, relativePath, bytes) => {
      writes += 1;
      if (step !== "DELETE" && writes === failingWrite[step]) {
        throw new Error("The disk does not take it");
      }
      await DEFAULT_EXPORT_OPERATIONS.replace(workspaceRoot, relativePath, bytes);
    },
    remove: (absolutePath) => (step === "DELETE" ? Promise.reject(new Error("The file is open")) : DEFAULT_EXPORT_OPERATIONS.remove(absolutePath)),
  };
}

async function makeWorld(approvers: number): Promise<{ world: IssueWorld; workspace: string }> {
  const world = await createIssueWorld("FIXTURE");
  const workspace = await mkdtemp(join(tmpdir(), "rv-export-property-"));
  await world.setFixtureFacts(FIXTURE_FACTS.filter((fact) => fact.factId !== "fx-2"));
  await world.addIssue(fixtureIssue());
  for (let index = 0; index < approvers; index += 1) {
    await world.approve("issue-1", 1, `approver-${index}`, new Date(Date.parse("2026-11-13T01:00:00Z") + index * 60_000).toISOString());
  }
  return { world, workspace };
}

async function exportOnce(world: IssueWorld, workspace: string, operations?: ExportFileOperations, generatedAt = GENERATED_AT) {
  let tick = 0;
  return runIssuesExport(
    { workspaceRoot: workspace, dataKind: "FIXTURE", generatedAt },
    {
      now: () => new Date(Date.parse("2026-11-13T05:00:00Z") + 1000 * tick++).toISOString(),
      inputs: world.inputs,
      settings: () => Promise.resolve(ISSUE_SETTINGS),
      ...(operations === undefined ? {} : { operations }),
    },
  );
}

async function currentDigest(world: IssueWorld) {
  const loaded = await loadIssueSnapshot(world.inputs, ISSUE_SETTINGS);
  if (!loaded.ok) {
    throw new Error("The input was not loaded");
  }
  return loaded.value.inputDigest;
}

describe("issues export: properties (Property 61)", () => {
  /** **Validates: Requirements 13.1, 13.4, 12.19** */
  it("gives the same bytes for the same input and the same time, whatever the number of approvals, and says OK for the current input", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (approvers) => {
        const { world, workspace } = await makeWorld(approvers);
        try {
          expect((await exportOnce(world, workspace)).ok).toBe(true);
          const first = await readFile(join(workspace, ...OUTPUT, "issues.json"), "utf8");
          expect((await exportOnce(world, workspace)).ok).toBe(true);
          expect(await readFile(join(workspace, ...OUTPUT, "issues.json"), "utf8")).toBe(first);
          expect((await verifyOutput({ workspaceRoot: workspace, dataKind: "FIXTURE" }, { currentInputDigest: await currentDigest(world) })).status).toBe("OK");
        } finally {
          await world.remove();
          await rm(workspace, { recursive: true, force: true });
        }
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 13.4** */
  it("changes the input digest and makes the output STALE when the input changes, for each kind of change", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("APPROVE", "REVOKE", "NEW_VERSION", "FACT"), async (change) => {
        const { world, workspace } = await makeWorld(1);
        try {
          expect((await exportOnce(world, workspace)).ok).toBe(true);
          const before = await currentDigest(world);
          switch (change) {
            case "APPROVE":
              await world.approve("issue-1", 1, "approver-other", "2026-11-13T02:00:00.000Z");
              break;
            case "REVOKE":
              await world.revoke("issue-1", 1, "approver-0", "2026-11-13T02:00:00.000Z");
              break;
            case "NEW_VERSION":
              await world.addIssue(fixtureIssue("issue-1", 2, { title: "別の題" }));
              break;
            case "FACT":
              await world.setFixtureFacts(FIXTURE_FACTS.filter((fact) => fact.factId !== "fx-2").map((fact) => ({ ...fact, value: { ...fact.value, amount: 99 } })));
              break;
          }
          const after = await currentDigest(world);
          expect(after).not.toBe(before);
          expect((await verifyOutput({ workspaceRoot: workspace, dataKind: "FIXTURE" }, { currentInputDigest: after })).status).toBe("STALE");
        } finally {
          await world.remove();
          await rm(workspace, { recursive: true, force: true });
        }
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 13.1, 13.4** */
  it("never leaves an output that says OK for the current input after a run that failed at any step, even when the old file is still on the disk", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<Step>("STATE_WRITE_1", "FILE_WRITE", "STATE_WRITE_2", "DELETE"), fc.boolean(), async (step, inputChanged) => {
        const { world, workspace } = await makeWorld(1);
        try {
          expect((await exportOnce(world, workspace)).ok).toBe(true);
          if (inputChanged) {
            await world.approve("issue-1", 1, "approver-other", "2026-11-13T02:00:00.000Z");
          }
          const outcome = await exportOnce(world, workspace, failingAt(step), "2026-01-05T09:00:00Z");
          expect(outcome.ok).toBe(false);
          const place = { workspaceRoot: workspace, dataKind: "FIXTURE" } as const;
          const current = await verifyOutput(place, { currentInputDigest: await currentDigest(world) });
          if (step === "STATE_WRITE_1") {
            // Nothing was changed, so the old output is the old output: it is valid for the old input only.
            expect(current.status).toBe(inputChanged ? "STALE" : "OK");
          } else {
            expect(current.status).not.toBe("OK");
            expect((await verifyOutput(place)).status).not.toBe("OK");
          }
        } finally {
          await world.remove();
          await rm(workspace, { recursive: true, force: true });
        }
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 13.1** */
  it("is valid again after a run that succeeds, whatever the failures before it", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom<Step>("STATE_WRITE_1", "FILE_WRITE", "STATE_WRITE_2", "DELETE"), { minLength: 1, maxLength: 3 }), async (steps) => {
        const { world, workspace } = await makeWorld(1);
        try {
          for (const step of steps) {
            await exportOnce(world, workspace, failingAt(step));
          }
          expect((await exportOnce(world, workspace)).ok).toBe(true);
          expect((await verifyOutput({ workspaceRoot: workspace, dataKind: "FIXTURE" }, { currentInputDigest: await currentDigest(world) })).status).toBe("OK");
        } finally {
          await world.remove();
          await rm(workspace, { recursive: true, force: true });
        }
      }),
      PARAMETERS,
    );
  });
});
