import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { IssuesExportReportSchema, IssuesFileSchema } from "@ehime-vote-navigator/contracts";
import type { FixtureFact } from "@ehime-vote-navigator/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FIXTURE_FACTS } from "../../../../../tests/harness/regional-values/draftSupport.js";
import { createIssueWorld, fixtureIssue, ISSUE_SETTINGS, realIssue } from "../../../../../tests/harness/regional-values/issueSupport.js";
import type { IssueWorld } from "../../../../../tests/harness/regional-values/issueSupport.js";
import { DEFAULT_EXPORT_OPERATIONS, runIssuesExport, sha256OfBytes, verifyOutput } from "./exportIssues.js";
import type { ExportFileOperations, ExportOutcome } from "./exportIssues.js";
import { loadIssueSnapshot } from "./loadIssueSnapshot.js";

// The records are fictional. The directory of the output is a temporary directory, never the repository's `dist`.

const FACT_1 = FIXTURE_FACTS[0] as FixtureFact;
const FACT_3 = FIXTURE_FACTS[2] as FixtureFact;
const GENERATED_AT = "2026-01-04T09:00:00Z";
const OUTPUT = "dist/regional-values/issues/fixture";

function clock(): () => string {
  let step = 0;
  return () => new Date(Date.parse("2026-11-13T00:00:00Z") + 1000 * step++).toISOString();
}

/** The operations of the files, with a write that fails on the given calls (1 is the first write: the state RUNNING). */
function failingWrites(...calls: number[]): ExportFileOperations {
  let count = 0;
  return {
    ...DEFAULT_EXPORT_OPERATIONS,
    replace: async (workspaceRoot, relativePath, bytes) => {
      count += 1;
      if (calls.includes(count)) {
        throw new Error("The disk does not take it");
      }
      await DEFAULT_EXPORT_OPERATIONS.replace(workspaceRoot, relativePath, bytes);
    },
  };
}

const failingRemove: ExportFileOperations = {
  ...DEFAULT_EXPORT_OPERATIONS,
  remove: () => Promise.reject(new Error("The file is open")),
};

describe("issues export: the output and the state record", () => {
  let world: IssueWorld;
  let workspace: string;

  const place = (): { workspaceRoot: string; dataKind: "FIXTURE" } => ({ workspaceRoot: workspace, dataKind: "FIXTURE" });
  const run = (over: { operations?: ExportFileOperations; settings?: () => Promise<typeof ISSUE_SETTINGS | null>; generatedAt?: string } = {}): Promise<ExportOutcome> =>
    runIssuesExport(
      { workspaceRoot: workspace, dataKind: "FIXTURE", generatedAt: over.generatedAt ?? GENERATED_AT },
      {
        now: clock(),
        inputs: world.inputs,
        settings: over.settings ?? (() => Promise.resolve(ISSUE_SETTINGS)),
        ...(over.operations === undefined ? {} : { operations: over.operations }),
      },
    );
  const readOutput = (name: string): Promise<string> => readFile(join(workspace, ...OUTPUT.split("/"), name), "utf8");
  const stateOf = async () => IssuesExportReportSchema.parse(JSON.parse(await readOutput("issues-export-report.json")));
  const currentDigest = async () => {
    const loaded = await loadIssueSnapshot(world.inputs, ISSUE_SETTINGS);
    if (!loaded.ok) {
      throw new Error("The input was not loaded");
    }
    return loaded.value.inputDigest;
  };

  beforeEach(async () => {
    world = await createIssueWorld("FIXTURE");
    workspace = await mkdtemp(join(tmpdir(), "rv-export-"));
    await world.setFixtureFacts([FACT_1, FACT_3]);
    await world.addIssue(fixtureIssue());
    await world.approve("issue-1", 1, "approver-a", "2026-11-13T01:00:00Z");
  });
  afterEach(async () => {
    await world.remove();
    await rm(workspace, { recursive: true, force: true });
  });

  it("writes issues.json and a state record of SUCCESS that names that file", async () => {
    const outcome = await run();
    expect(outcome).toMatchObject({ ok: true, issueCount: 1, withdrawnCount: 0 });
    const text = await readOutput("issues.json");
    const file = IssuesFileSchema.parse(JSON.parse(text));
    expect(file.meta).toMatchObject({ kind: "ISSUES", dataKind: "FIXTURE", generatedAt: GENERATED_AT });
    expect(file.issues.map((issue) => issue.issueId)).toEqual(["issue-1"]);
    const state = await stateOf();
    expect(state).toMatchObject({ status: "SUCCESS", exitCode: 0, failureCode: null, invalidated: null });
    expect(state.output).toEqual({
      fileSha256: sha256OfBytes(new TextEncoder().encode(text)),
      contentHash: file.meta.contentHash,
      inputDigest: file.meta.inputDigest,
      generatedAt: GENERATED_AT,
      issuesSchemaVersion: 1,
      issueCount: 1,
      withdrawnCount: 0,
    });
    expect(state.lastSuccess).toMatchObject({ fileSha256: state.output?.fileSha256 });
    expect(await verifyOutput(place())).toMatchObject({ status: "OK" });
    expect(await verifyOutput(place(), { currentInputDigest: await currentDigest() })).toMatchObject({ status: "OK" });
  });

  it("gives the same bytes and the same hashes for the same input and the same time", async () => {
    await run();
    const first = await readOutput("issues.json");
    await run();
    expect(await readOutput("issues.json")).toBe(first);
  });

  it("is STALE when the input changed after the output, and the old file is not touched", async () => {
    await run();
    const before = await readOutput("issues.json");
    await world.approve("issue-1", 1, "approver-b", "2026-11-13T02:00:00Z");
    expect(await verifyOutput(place(), { currentInputDigest: await currentDigest() })).toMatchObject({ status: "STALE" });
    expect(await readOutput("issues.json")).toBe(before);
    // Without the current input it cannot tell, and says OK for what the state record says.
    expect(await verifyOutput(place())).toMatchObject({ status: "OK" });
    await run();
    expect(await verifyOutput(place(), { currentInputDigest: await currentDigest() })).toMatchObject({ status: "OK" });
  });

  describe("a run that fails leaves no valid old output", () => {
    it("a file that cannot be deleted stays on the disk, and is INVALIDATED (DELETE_FAILED)", async () => {
      await run();
      const first = await stateOf();
      const outcome = await run({ operations: failingRemove, generatedAt: "2026-01-05T09:00:00Z" });
      expect(outcome).toEqual({ ok: false, code: "DELETE_FAILED" });
      // The old file is still there, and it is not taken for a valid output.
      expect(IssuesFileSchema.safeParse(JSON.parse(await readOutput("issues.json"))).success).toBe(true);
      const state = await stateOf();
      expect(state).toMatchObject({ status: "FAILED", exitCode: 1, failureCode: "DELETE_FAILED", output: null });
      expect(state.invalidated).toMatchObject({ deleted: false, fileSha256: first.output?.fileSha256 });
      expect(state.lastSuccess).toEqual(first.lastSuccess);
      expect((await verifyOutput(place())).status).toBe("INVALIDATED");
    });

    it("a write of the file that fails: the old file is gone, the state is FAILED with the input digest, and the last success is kept", async () => {
      await run();
      const first = await stateOf();
      const outcome = await run({ operations: failingWrites(2), generatedAt: "2026-01-05T09:00:00Z" });
      expect(outcome).toEqual({ ok: false, code: "WRITE_FAILED" });
      await expect(readOutput("issues.json")).rejects.toMatchObject({ code: "ENOENT" });
      const state = await stateOf();
      expect(state).toMatchObject({ status: "FAILED", failureCode: "WRITE_FAILED", inputDigest: await currentDigest(), output: null });
      expect(state.invalidated).toMatchObject({ deleted: true });
      expect(state.lastSuccess).toEqual(first.lastSuccess);
      expect((await verifyOutput(place())).status).toBe("INVALIDATED");
    });

    it("a state record that cannot be written first stops the run with nothing changed (EXPORT_STATE_NOT_RECORDED)", async () => {
      await run();
      const file = await readOutput("issues.json");
      const state = await readOutput("issues-export-report.json");
      const outcome = await run({ operations: failingWrites(1), generatedAt: "2026-01-05T09:00:00Z" });
      expect(outcome).toEqual({ ok: false, code: "EXPORT_STATE_NOT_RECORDED" });
      expect(await readOutput("issues.json")).toBe(file);
      expect(await readOutput("issues-export-report.json")).toBe(state);
    });

    it("a state record of SUCCESS that cannot be written leaves RUNNING, and the new file is not taken for valid (EXPORT_STATE_NOT_FINALIZED)", async () => {
      const outcome = await run({ operations: failingWrites(3) });
      expect(outcome).toEqual({ ok: false, code: "EXPORT_STATE_NOT_FINALIZED" });
      expect(IssuesFileSchema.safeParse(JSON.parse(await readOutput("issues.json"))).success).toBe(true);
      expect((await stateOf()).status).toBe("RUNNING");
      expect((await verifyOutput(place())).status).toBe("INVALIDATED");
    });

    it("a state of FAILED that cannot be written leaves RUNNING, which is not SUCCESS either", async () => {
      await run();
      // The second write is the state FAILED, which the run makes after its settings turn out to be unusable.
      const outcome = await run({ operations: failingWrites(2), settings: () => Promise.resolve(null) });
      expect(outcome).toEqual({ ok: false, code: "INPUT_UNREADABLE" });
      expect((await stateOf()).status).toBe("RUNNING");
      expect((await verifyOutput(place())).status).toBe("INVALIDATED");
    });

    it("settings that cannot be used fail the run after the old output was made invalid (INPUT_UNREADABLE)", async () => {
      await run();
      expect(await run({ settings: () => Promise.resolve(null) })).toEqual({ ok: false, code: "INPUT_UNREADABLE" });
      await expect(readOutput("issues.json")).rejects.toMatchObject({ code: "ENOENT" });
      expect(await stateOf()).toMatchObject({ status: "FAILED", failureCode: "INPUT_UNREADABLE", inputDigest: null });
    });

    it("a record of the other data kind fails the run, and the output is not written (DATA_KIND_MIXED)", async () => {
      await run();
      await world.addIssue(realIssue("issue-r1"));
      expect(await run()).toEqual({ ok: false, code: "DATA_KIND_MIXED" });
      await expect(readOutput("issues.json")).rejects.toMatchObject({ code: "ENOENT" });
      expect((await verifyOutput(place())).status).toBe("INVALIDATED");
    });

    it("a run that succeeds after a failure is valid again", async () => {
      await run();
      await run({ operations: failingRemove });
      expect((await verifyOutput(place())).status).toBe("INVALIDATED");
      expect(await run()).toMatchObject({ ok: true });
      expect((await verifyOutput(place())).status).toBe("OK");
    });
  });

  describe("verifyOutput does not call a file valid because it exists", () => {
    it("is INVALIDATED when the meta of the file is not what the state record says, and CONTRACT_INVALID for a version of the contract that is not the current one", async () => {
      await run();
      const stateFile = join(workspace, ...OUTPUT.split("/"), "issues-export-report.json");
      const state = await stateOf();
      // The state record names another input digest than the one that the file was made from.
      const other = "0".repeat(64);
      await writeFile(stateFile, JSON.stringify({ ...state, output: { ...state.output, inputDigest: other }, inputDigest: other }));
      expect((await verifyOutput(place())).status).toBe("INVALIDATED");
      // The state record names another content hash.
      await writeFile(stateFile, JSON.stringify({ ...state, output: { ...state.output, contentHash: other } }));
      expect((await verifyOutput(place())).status).toBe("INVALIDATED");
      // The file has a version of the contract that is not the current one, and the state record names that very file.
      const issuesFile = join(workspace, ...OUTPUT.split("/"), "issues.json");
      const old = JSON.stringify({ ...JSON.parse(await readFile(issuesFile, "utf8")), meta: { ...(JSON.parse(await readFile(issuesFile, "utf8")) as { meta: object }).meta, schemaVersion: 0 } });
      await writeFile(issuesFile, old);
      await writeFile(stateFile, JSON.stringify({ ...state, output: { ...state.output, fileSha256: sha256OfBytes(new TextEncoder().encode(old)) } }));
      expect((await verifyOutput(place())).status).toBe("CONTRACT_INVALID");
    });

    it("is INVALIDATED without a state record, with one that cannot be read, and for a file that differs from the record", async () => {
      expect((await verifyOutput(place())).status).toBe("INVALIDATED");
      await run();
      const stateFile = join(workspace, ...OUTPUT.split("/"), "issues-export-report.json");
      const issuesFile = join(workspace, ...OUTPUT.split("/"), "issues.json");
      const text = await readFile(issuesFile, "utf8");

      await writeFile(issuesFile, `${text} `);
      expect((await verifyOutput(place())).status).toBe("INVALIDATED");
      await writeFile(issuesFile, text);
      expect((await verifyOutput(place())).status).toBe("OK");

      const state = await readFile(stateFile, "utf8");
      await writeFile(stateFile, "{ not json");
      expect((await verifyOutput(place())).status).toBe("INVALIDATED");
      await writeFile(stateFile, state);
      await rm(issuesFile);
      expect((await verifyOutput(place())).status).toBe("INVALIDATED");
    });

    it("is CONTRACT_INVALID for a file that the state record names but the contract does not accept", async () => {
      await run();
      const issuesFile = join(workspace, ...OUTPUT.split("/"), "issues.json");
      const stateFile = join(workspace, ...OUTPUT.split("/"), "issues-export-report.json");
      const changed = JSON.stringify({ ...JSON.parse(await readFile(issuesFile, "utf8")), extra: true });
      await writeFile(issuesFile, changed);
      const state = await stateOf();
      await writeFile(
        stateFile,
        JSON.stringify({ ...state, output: { ...state.output, fileSha256: sha256OfBytes(new TextEncoder().encode(changed)) } }),
      );
      expect((await verifyOutput(place())).status).toBe("CONTRACT_INVALID");
    });
  });
});
