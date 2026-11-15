import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { IssuesReceiptSchema } from "@ehime-vote-navigator/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TEST_WORDS } from "../../../../../tests/harness/regional-values/draftSupport.js";
import {
  createIssueWorld,
  ISSUE_SETTINGS,
  ORIGINAL_BYTES,
  realIssue,
  realMaterial,
} from "../../../../../tests/harness/regional-values/issueSupport.js";
import type { IssueWorld } from "../../../../../tests/harness/regional-values/issueSupport.js";
import { hashOf } from "../draft/approvalLedger.js";
import { runRegionalValuesCli } from "../cli.js";
import { runIssuesExport, verifyOutput } from "./exportIssues.js";
import { createReceipt, readReceipts, RECEIPT_DIRECTORY } from "./receipt.js";

// The records are made for the test. The workspace and the directory of the receipts are temporary directories.

const T1 = "2026-11-13T01:00:00.000Z";
const TEST_CONFIG = new URL("../../../../../tests/harness/regional-values/test-config/", import.meta.url);
const configPath = (name: string): string => fileURLToPath(new URL(name, TEST_CONFIG));

describe("the receipt of an issues.json of real data (16.17)", () => {
  let world: IssueWorld;
  let workspace: string;
  let receipts: string;
  let settingsFile: string;

  const place = (): { workspaceRoot: string; dataKind: "REAL_AI" } => ({ workspaceRoot: workspace, dataKind: "REAL_AI" });
  const fileText = (): Promise<string> => readFile(join(workspace, "dist", "regional-values", "issues", "real", "issues.json"), "utf8");

  async function exportReal(generatedAt = "2026-11-13T04:00:00Z"): Promise<void> {
    const outcome = await runIssuesExport(
      { workspaceRoot: workspace, dataKind: "REAL_AI", generatedAt },
      { now: () => "2026-11-13T05:00:00.000Z", inputs: world.inputs, settings: () => Promise.resolve(ISSUE_SETTINGS) },
    );
    expect(outcome.ok).toBe(true);
  }

  async function digest() {
    const loaded = await world.load();
    if (!loaded.ok) {
      throw new Error("The input was not loaded");
    }
    return loaded.value.inputDigest;
  }

  const sha256Of = async (): Promise<string> => {
    const state = JSON.parse(await readFile(join(workspace, "dist", "regional-values", "issues", "real", "issues-export-report.json"), "utf8")) as {
      output: { fileSha256: string } | null;
    };
    // A run that failed has no output: any SHA-256 does for a test that expects a refusal.
    return state.output?.fileSha256 ?? "0".repeat(64);
  };

  async function receiptFiles(): Promise<string[]> {
    try {
      return (await readdir(receipts)).sort();
    } catch {
      return [];
    }
  }

  async function receipt(over: Record<string, unknown> = {}) {
    return createReceipt(
      place(),
      { deliveredBy: "handler-a", receivedBy: "co-developer-b", receivedAt: "2026-11-13T06:00:00Z", receivedSha256: await sha256Of(), ...over },
      { currentInputDigest: await digest(), receiptDirectory: receipts },
    );
  }

  beforeEach(async () => {
    world = await createIssueWorld("REAL_AI");
    workspace = await mkdtemp(join(tmpdir(), "rv-receipt-"));
    receipts = join(workspace, "receipts");
    settingsFile = join(workspace, "draft-settings.json");
    const { fact, source } = realMaterial();
    await world.setRealFact(fact);
    await world.setRealSource(source);
    await world.setOriginal(source, ORIGINAL_BYTES);
    await world.addIssue(realIssue());
    await world.approve("issue-r1", 1, "approver-a", T1);
    await writeFile(
      settingsFile,
      JSON.stringify({ ...JSON.parse(await readFile(configPath("draft-settings.json"), "utf8")), ...TEST_WORDS }),
    );
  });
  afterEach(async () => {
    await world.remove();
    await rm(workspace, { recursive: true, force: true });
  });

  describe("createReceipt", () => {
    it("writes a receipt that has the five items of the file, the people that it was told, and the fixed value that they are self-reported", async () => {
      await exportReal();
      const outcome = await receipt();
      expect(outcome.ok).toBe(true);
      const files = await receiptFiles();
      expect(files).toHaveLength(1);
      const written = IssuesReceiptSchema.parse(JSON.parse(await readFile(join(receipts, files[0] ?? ""), "utf8")));
      const file = JSON.parse(await fileText()) as { meta: Record<string, unknown> };
      expect(written).toEqual({
        schemaVersion: 1,
        kind: "ISSUES_RECEIPT",
        dataKind: "REAL_AI",
        issuesSchemaVersion: 1,
        generatedAt: file.meta.generatedAt,
        fileSha256: await sha256Of(),
        contentHash: file.meta.contentHash,
        inputDigest: file.meta.inputDigest,
        issueCount: 1,
        withdrawnCount: 0,
        deliveredBy: "handler-a",
        receivedBy: "co-developer-b",
        receivedAt: "2026-11-13T06:00:00Z",
        attestation: "SELF_REPORTED",
      });
      // The file is named by the SHA-256 of its own content.
      expect(files[0]).toBe(`${hashOf(written)}.json`);
    });

    it("has no text of an issue, and no field of an approved issue", async () => {
      await exportReal();
      await receipt();
      const text = await readFile(join(receipts, (await receiptFiles())[0] ?? ""), "utf8");
      for (const word of ["試験町", "施設", "statement", "title", "basisFacts", "responseDirections", "approverId", "issueId"]) {
        expect(text).not.toContain(word);
      }
    });

    it("is the same file when it is written again: nothing is added", async () => {
      await exportReal();
      expect(await receipt()).toMatchObject({ ok: true, value: { state: "created" } });
      expect(await receipt()).toMatchObject({ ok: true, value: { state: "already-present" } });
      expect(await receiptFiles()).toHaveLength(1);
    });

    it("writes nothing when the SHA-256 that was told is not the SHA-256 of the output", async () => {
      await exportReal();
      expect(await receipt({ receivedSha256: "f".repeat(64) })).toEqual({ ok: false, error: { code: "SHA256_MISMATCH" } });
      expect(await receipt({ receivedSha256: "not a hash" })).toEqual({ ok: false, error: { code: "ARGUMENT_INVALID" } });
      expect(await receiptFiles()).toEqual([]);
    });

    it("writes nothing for an argument that is not an ID or a time", async () => {
      await exportReal();
      for (const over of [{ deliveredBy: "" }, { receivedBy: "x".repeat(65) }, { receivedAt: "yesterday" }]) {
        expect(await receipt(over), JSON.stringify(over)).toEqual({ ok: false, error: { code: "ARGUMENT_INVALID" } });
      }
      expect(await receiptFiles()).toEqual([]);
    });

    it("writes nothing when the output is stale: the input changed after it was written", async () => {
      await exportReal();
      await world.approve("issue-r1", 1, "approver-b", "2026-11-13T02:00:00.000Z");
      expect(await receipt()).toEqual({ ok: false, error: { code: "OUTPUT_NOT_OK", outputStatus: "STALE" } });
      expect(await receiptFiles()).toEqual([]);
    });

    it("writes nothing when the run failed or has not finished, whatever the old file says", async () => {
      await exportReal();
      const told = await sha256Of();
      const failed = await runIssuesExport(
        { workspaceRoot: workspace, dataKind: "REAL_AI", generatedAt: "2026-11-13T04:00:00Z" },
        { now: () => "2026-11-13T05:00:00.000Z", inputs: world.inputs, settings: () => Promise.resolve(null) },
      );
      expect(failed).toEqual({ ok: false, code: "INPUT_UNREADABLE" });
      expect(await receipt({ receivedSha256: told })).toEqual({ ok: false, error: { code: "OUTPUT_NOT_OK", outputStatus: "INVALIDATED" } });
      expect(await receiptFiles()).toEqual([]);
    });

    it("writes nothing when there is no output, and nothing for the fictional data", async () => {
      expect(await createReceipt(place(), { deliveredBy: "a", receivedBy: "b", receivedAt: "2026-11-13T06:00:00Z", receivedSha256: "a".repeat(64) }, { currentInputDigest: await digest(), receiptDirectory: receipts })).toEqual({
        ok: false,
        error: { code: "OUTPUT_NOT_OK", outputStatus: "INVALIDATED" },
      });
      expect(
        await createReceipt(
          { workspaceRoot: workspace, dataKind: "FIXTURE" },
          { deliveredBy: "a", receivedBy: "b", receivedAt: "2026-11-13T06:00:00Z", receivedSha256: "a".repeat(64) },
          { currentInputDigest: await digest(), receiptDirectory: receipts },
        ),
      ).toEqual({ ok: false, error: { code: "DATA_KIND_NOT_ALLOWED" } });
      expect(await receiptFiles()).toEqual([]);
    });
  });

  describe("issues receipt and issues verify --file (the commands)", () => {
    async function cli(...args: string[]): Promise<{ code: number; lines: string[] }> {
      const lines: string[] = [];
      const code = await runRegionalValuesCli(["issues", ...args], {
        workspaceRoot: workspace,
        io: { write: (line) => lines.push(line) },
        now: () => new Date("2026-11-13T05:00:00Z"),
        issues: { recordRoot: () => world.root, inputs: () => world.inputs, receiptDirectory: receipts },
      });
      return { code, lines };
    }
    const settings = (): string[] => ["--config-dir", configPath("."), "--draft-settings", settingsFile];
    const issuesPath = (): string => join(workspace, "dist", "regional-values", "issues", "real", "issues.json");

    async function exportByCommand(generatedAt = "2026-11-13T04:00:00Z"): Promise<void> {
      expect(await cli("export", "--data-mode", "REAL", "--generated-at", generatedAt, ...settings())).toEqual({
        code: 0,
        lines: ["code=EXPORT_OK issues=1 withdrawn=0"],
      });
    }
    const receiptArguments = async (over: Record<string, string> = {}): Promise<string[]> =>
      Object.entries({
        "--delivered-by": "handler-a",
        "--received-by": "co-developer-b",
        "--received-at": "2026-11-13T06:00:00Z",
        "--received-sha256": await sha256Of(),
        ...over,
      }).flat();

    it("writes the receipt of an output that is valid and current, and the received file is then OK", async () => {
      await exportByCommand();
      // Before the receipt, the file passes the contract, and the receiver is told its SHA-256 but not that it may be used.
      const before = await cli("verify", "--file", issuesPath());
      expect(before.code).toBe(1);
      expect(before.lines).toEqual([`fileSha256=${await sha256Of()}`, "code=VERIFY_FAILED status=RECEIPT_MISSING"]);

      expect(await cli("receipt", "--data-mode", "REAL", ...settings(), ...(await receiptArguments()))).toEqual({
        code: 0,
        lines: ["code=RECEIPT_OK state=created"],
      });
      expect(await cli("verify", "--file", issuesPath())).toEqual({
        code: 0,
        lines: [`fileSha256=${await sha256Of()}`, "code=VERIFY_OK dataKind=REAL_AI"],
      });
      expect(await cli("receipt", "--data-mode", "REAL", ...settings(), ...(await receiptArguments()))).toEqual({
        code: 0,
        lines: ["code=RECEIPT_OK state=already-present"],
      });
    });

    it("refuses a receipt for a file of another SHA-256, a stale output and the fictional data, with a fixed code", async () => {
      await exportByCommand();
      expect(await cli("receipt", "--data-mode", "REAL", ...settings(), ...(await receiptArguments({ "--received-sha256": "e".repeat(64) })))).toEqual({
        code: 1,
        lines: ["code=RECEIPT_REFUSED reason=SHA256_MISMATCH"],
      });
      await world.approve("issue-r1", 1, "approver-b", "2026-11-13T02:00:00.000Z");
      expect(await cli("receipt", "--data-mode", "REAL", ...settings(), ...(await receiptArguments()))).toEqual({
        code: 1,
        lines: ["code=RECEIPT_REFUSED reason=OUTPUT_NOT_OK status=STALE"],
      });
      expect((await cli("receipt", "--data-mode", "FIXTURE", ...settings(), ...(await receiptArguments()))).lines).toEqual([
        "code=RECEIPT_REFUSED reason=DATA_KIND_NOT_ALLOWED",
      ]);
      expect(await receiptFiles()).toEqual([]);
    });

    it("does not accept a file that differs from the receipt (RECEIPT_MISMATCH) and a file that is not the contract (CONTRACT_INVALID)", async () => {
      await exportByCommand();
      await cli("receipt", "--data-mode", "REAL", ...settings(), ...(await receiptArguments()));
      // Another output of the same input at another time: the receipt names the file that was handed over.
      await exportByCommand("2026-11-13T04:30:00Z");
      const other = await cli("verify", "--file", issuesPath());
      expect(other.code).toBe(1);
      expect(other.lines.at(-1)).toBe("code=VERIFY_FAILED status=RECEIPT_MISMATCH");

      await writeFile(issuesPath(), "{ not json");
      expect((await cli("verify", "--file", issuesPath())).lines.at(-1)).toBe("code=VERIFY_FAILED status=CONTRACT_INVALID detail=SCHEMA");
      expect((await cli("verify", "--file", join(workspace, "no-such-file.json"))).lines).toEqual(["code=VERIFY_FAILED status=FILE_UNREADABLE"]);
    });

    it("is RECEIPT_MISMATCH when any one of the five items of the receipt is not that of the file", async () => {
      await exportByCommand();
      await cli("receipt", "--data-mode", "REAL", ...settings(), ...(await receiptArguments()));
      const original = IssuesReceiptSchema.parse(JSON.parse(await readFile(join(receipts, (await receiptFiles())[0] ?? ""), "utf8")));
      expect((await cli("verify", "--file", issuesPath())).lines.at(-1)).toBe("code=VERIFY_OK dataKind=REAL_AI");
      const variants: [string, unknown][] = [
        ["fileSha256", "1".repeat(64)],
        ["contentHash", "2".repeat(64)],
        ["inputDigest", "3".repeat(64)],
        ["generatedAt", "2026-11-13T09:00:00Z"],
        ["issuesSchemaVersion", 2],
      ];
      for (const [field, value] of variants) {
        await rm(receipts, { recursive: true, force: true });
        await mkdir(receipts, { recursive: true });
        const changed = IssuesReceiptSchema.parse({ ...original, [field]: value });
        await writeFile(join(receipts, `${hashOf(changed)}.json`), JSON.stringify(changed));
        const result = await cli("verify", "--file", issuesPath());
        expect(result.code, field).toBe(1);
        expect(result.lines.at(-1), field).toBe("code=VERIFY_FAILED status=RECEIPT_MISMATCH");
      }
    });

    it("does not guess which receipt is the latest: with more than one receipt it refuses (open decision (i-13))", async () => {
      await exportByCommand();
      await cli("receipt", "--data-mode", "REAL", ...settings(), ...(await receiptArguments()));
      await exportByCommand("2026-11-13T04:30:00Z");
      await cli("receipt", "--data-mode", "REAL", ...settings(), ...(await receiptArguments({ "--received-at": "2026-11-13T07:00:00Z" })));
      expect(await receiptFiles()).toHaveLength(2);
      expect((await cli("verify", "--file", issuesPath())).lines.at(-1)).toBe("code=VERIFY_FAILED status=RECEIPT_LATEST_UNDECIDED");
    });

    it("refuses a receipt directory that has a file that is not a receipt, or is not named by its own SHA-256", async () => {
      await exportByCommand();
      await cli("receipt", "--data-mode", "REAL", ...settings(), ...(await receiptArguments()));
      expect(await readReceipts(receipts)).toHaveLength(1);
      await writeFile(join(receipts, `${"0".repeat(64)}.json`), JSON.stringify({ not: "a receipt" }));
      expect(await readReceipts(receipts)).toBeNull();
      expect((await cli("verify", "--file", issuesPath())).lines.at(-1)).toBe("code=VERIFY_FAILED status=RECEIPT_INVALID");
    });

    it("prints only fixed codes: no text of an issue, a path or a name", async () => {
      await exportByCommand();
      const printed = [
        ...(await cli("receipt", "--data-mode", "REAL", ...settings(), ...(await receiptArguments()))).lines,
        ...(await cli("verify", "--file", issuesPath())).lines,
      ];
      for (const line of printed) {
        expect(line).toMatch(/^(code=[A-Z_]+( [A-Za-z]+=[A-Za-z0-9_]+)*|fileSha256=[0-9a-f]{64})$/u);
        expect(line).not.toContain("handler-a");
      }
    });
  });

  it("keeps the receipts where the repository keeps them: below the records of the spec, which are in Git", () => {
    expect(RECEIPT_DIRECTORY).toBe(".kiro/specs/regional-values-map/records/issues-receipts");
  });

  it("does not need the directory of the receipts to exist when there is no receipt", async () => {
    await mkdir(workspace, { recursive: true });
    expect(await readReceipts(join(workspace, "no-receipts-here"))).toEqual([]);
    expect(await verifyOutput(place())).toMatchObject({ status: "INVALIDATED" });
  });
});
