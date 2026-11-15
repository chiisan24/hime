import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_FACTS, TEST_WORDS } from "../../../../tests/harness/regional-values/draftSupport.js";
import { createIssueWorld, fixtureIssue } from "../../../../tests/harness/regional-values/issueSupport.js";
import type { IssueWorld } from "../../../../tests/harness/regional-values/issueSupport.js";
import { runRegionalValuesCli } from "./cli.js";
import type { ExportFileOperations } from "./issues/exportIssues.js";
import { DEFAULT_EXPORT_OPERATIONS } from "./issues/exportIssues.js";

// The commands `issues export|list|verify` (16.6). The records and the output are in temporary directories.

const TEST_CONFIG = fileURLToPath(new URL("../../../../tests/harness/regional-values/test-config/", import.meta.url));
const T1 = "2026-11-13T01:00:00.000Z";

describe("issues export, list and verify (the commands)", () => {
  let world: IssueWorld;
  let workspace: string;
  let settingsFile: string;

  async function cli(args: readonly string[], operations?: ExportFileOperations): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    const code = await runRegionalValuesCli(["issues", ...args], {
      workspaceRoot: workspace,
      io: { write: (line) => lines.push(line) },
      now: () => new Date("2026-11-13T05:00:00Z"),
      issues: { recordRoot: () => world.root, inputs: () => world.inputs, ...(operations === undefined ? {} : { operations }) },
    });
    return { code, lines };
  }
  const settings = (): string[] => ["--config-dir", TEST_CONFIG, "--draft-settings", settingsFile];
  const exportArguments = (): string[] => ["export", "--data-mode", "FIXTURE", "--generated-at", "2026-01-04T09:00:00Z", ...settings()];
  const output = (name: string): string => join(workspace, "dist", "regional-values", "issues", "fixture", name);

  beforeEach(async () => {
    world = await createIssueWorld("FIXTURE");
    workspace = await mkdtemp(join(tmpdir(), "rv-issues-cli-"));
    settingsFile = join(workspace, "draft-settings.json");
    await writeFile(settingsFile, JSON.stringify({ ...JSON.parse(await readFile(join(TEST_CONFIG, "draft-settings.json"), "utf8")), ...TEST_WORDS }));
    // The issue of the tests rests on fx-1 and fx-3.
    await world.setFixtureFacts(FIXTURE_FACTS.filter((fact) => fact.factId !== "fx-2"));
    await world.addIssue(fixtureIssue());
    await world.approve("issue-1", 1, "approver-a", T1);
  });
  afterEach(async () => {
    await world.remove();
    await rm(workspace, { recursive: true, force: true });
  });

  describe("arguments", () => {
    it("prints the usage for an unknown subcommand and for none", async () => {
      for (const args of [[], ["unknown"]]) {
        const result = await cli(args);
        expect(result.code).toBe(1);
        expect(result.lines.at(-1)).toBe("code=USAGE");
        expect(result.lines.some((line) => line.startsWith("Usage:"))).toBe(true);
      }
    });

    it("refuses what is not an argument of the command, with one fixed code and nothing written", async () => {
      const bad: string[][] = [
        ["export"],
        ["export", "--data-mode", "REAL_PREFERRED", ...settings()],
        ["export", "--data-mode", "DEMO", ...settings()],
        ["export", "--data-mode", "FIXTURE"],
        ["export", "--data-mode", "FIXTURE", "--kind", "demo", ...settings()],
        ["export", "--data-mode", "FIXTURE", "--generated-at", "tomorrow", ...settings()],
        ["export", "--data-mode", "FIXTURE", "extra", ...settings()],
        ["list", "--data-mode", "FIXTURE"],
        ["verify"],
        ["verify", "--output", "--file", "x.json"],
        ["verify", "--file", "x.json", "--current"],
        ["verify", "--output", "--data-mode", "FIXTURE", "--current", "--current"],
        ["receipt", "--data-mode", "REAL", ...settings()],
      ];
      for (const args of bad) {
        expect(await cli(args), args.join(" ")).toEqual({ code: 1, lines: ["code=ARGUMENT_INVALID"] });
      }
      await expect(readFile(output("issues.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  describe("export", () => {
    it("writes the file and says so with a code and two counts only", async () => {
      expect(await cli(exportArguments())).toEqual({ code: 0, lines: ["code=EXPORT_OK issues=1 withdrawn=0"] });
      expect(JSON.parse(await readFile(output("issues.json"), "utf8"))).toMatchObject({ meta: { generatedAt: "2026-01-04T09:00:00Z", dataKind: "FIXTURE" } });
    });

    it("uses the time of the clock when --generated-at is not given", async () => {
      const args = exportArguments().filter((_, index, all) => all[index] !== "--generated-at" && all[index - 1] !== "--generated-at");
      expect((await cli(args)).code).toBe(0);
      expect(JSON.parse(await readFile(output("issues.json"), "utf8"))).toMatchObject({ meta: { generatedAt: "2026-11-13T05:00:00.000Z" } });
    });

    it("fails with a fixed code, and without the text of anything, when the settings cannot be read", async () => {
      const result = await cli(["export", "--data-mode", "FIXTURE", "--config-dir", TEST_CONFIG, "--draft-settings", join(workspace, "no-such.json")]);
      expect(result).toEqual({ code: 1, lines: ["code=EXPORT_FAILED reason=INPUT_UNREADABLE"] });
    });

    it("fails with the fixed codes of the state record: a file that cannot be deleted, a state that cannot be written", async () => {
      await cli(exportArguments());
      const stuck: ExportFileOperations = { ...DEFAULT_EXPORT_OPERATIONS, remove: () => Promise.reject(new Error("open")) };
      expect(await cli(exportArguments(), stuck)).toEqual({ code: 1, lines: ["code=EXPORT_FAILED reason=DELETE_FAILED"] });
      const closed: ExportFileOperations = { ...DEFAULT_EXPORT_OPERATIONS, replace: () => Promise.reject(new Error("full")) };
      expect(await cli(exportArguments(), closed)).toEqual({ code: 1, lines: ["code=EXPORT_STATE_NOT_RECORDED"] });
    });

    it("is not a statement that the file may be used: only verify says it", async () => {
      await cli(exportArguments());
      await world.approve("issue-1", 1, "approver-b", "2026-11-13T02:00:00.000Z");
      // The same words are printed for the next export even though the file now on the disk is stale.
      expect(await cli(["verify", "--output", "--data-mode", "FIXTURE", "--current", ...settings()])).toEqual({ code: 1, lines: ["code=VERIFY_FAILED status=STALE"] });
    });
  });

  describe("list", () => {
    it("says that there is no output, then the state of the output, the issues and the withdrawn issues, by IDs and codes", async () => {
      const before = await cli(["list", "--data-mode", "FIXTURE", ...settings()]);
      expect(before).toEqual({ code: 0, lines: ["output=NONE", "issue=issue-1 version=1 theme=TRANSPORT approvers=1", "code=LIST_OK issues=1 withdrawn=0"] });

      await cli(exportArguments());
      const after = await cli(["list", "--data-mode", "FIXTURE", ...settings()]);
      expect(after.lines[0]).toBe("output=OK");
      expect(after.lines[1]).toMatch(/^lastSuccess generatedAt=2026-01-04T09:00:00Z inputDigest=[0-9a-f]{64}$/u);
      expect(after.lines.at(-1)).toBe("code=LIST_OK issues=1 withdrawn=0");

      await world.revoke("issue-1", 1, "approver-a", "2026-11-13T02:00:00.000Z");
      const revoked = await cli(["list", "--data-mode", "FIXTURE", ...settings()]);
      expect(revoked.lines[0]).toBe("output=STALE");
      expect(revoked.lines).toContain("withdrawn=issue-1 version=1 reasons=REVOKED,APPROVAL_INSUFFICIENT");
      expect(revoked.lines.at(-1)).toBe("code=LIST_OK issues=0 withdrawn=1");
    });

    it("does not read the file issues.json for the list: a file that is not valid does not change it", async () => {
      await cli(exportArguments());
      await writeFile(output("issues.json"), "{ not json");
      const result = await cli(["list", "--data-mode", "FIXTURE", ...settings()]);
      expect(result.lines[0]).toBe("output=INVALIDATED");
      expect(result.lines.at(-1)).toBe("code=LIST_OK issues=1 withdrawn=0");
    });

    it("prints no title, statement or text of a fact", async () => {
      await cli(exportArguments());
      const printed = (await cli(["list", "--data-mode", "FIXTURE", ...settings()])).lines.join("\n");
      for (const word of ["架空市のバス", "仮説語尾", "12本"]) {
        expect(printed).not.toContain(word);
      }
    });
  });

  describe("verify --output", () => {
    it("is OK for an output that the state record names, and OK with --current when the input did not change", async () => {
      await cli(exportArguments());
      expect(await cli(["verify", "--output", "--data-mode", "FIXTURE"])).toEqual({ code: 0, lines: ["code=VERIFY_OK current=false"] });
      expect(await cli(["verify", "--output", "--data-mode", "FIXTURE", "--current", ...settings()])).toEqual({ code: 0, lines: ["code=VERIFY_OK current=true"] });
    });

    it("is INVALIDATED for no output and for an output that a failed run left, and STALE when the input changed", async () => {
      expect(await cli(["verify", "--output", "--data-mode", "FIXTURE"])).toEqual({ code: 1, lines: ["code=VERIFY_FAILED status=INVALIDATED"] });
      await cli(exportArguments());
      const stuck: ExportFileOperations = { ...DEFAULT_EXPORT_OPERATIONS, remove: () => Promise.reject(new Error("open")) };
      await cli(exportArguments(), stuck);
      expect(await cli(["verify", "--output", "--data-mode", "FIXTURE"])).toEqual({ code: 1, lines: ["code=VERIFY_FAILED status=INVALIDATED"] });
      await cli(exportArguments());
      await world.revoke("issue-1", 1, "approver-a", "2026-11-13T02:00:00.000Z");
      expect(await cli(["verify", "--output", "--data-mode", "FIXTURE", "--current", ...settings()])).toEqual({ code: 1, lines: ["code=VERIFY_FAILED status=STALE"] });
    });

    it("says that the settings or the input cannot be used, with a fixed code, for --current", async () => {
      await cli(exportArguments());
      expect((await cli(["verify", "--output", "--data-mode", "FIXTURE", "--current", "--config-dir", TEST_CONFIG, "--draft-settings", join(workspace, "no-such.json")])).lines).toEqual([
        "code=CONFIG_UNREADABLE",
      ]);
    });
  });

  it("calls no fetch in any command: the judgment and the checks use the local records only", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await cli(exportArguments());
    await cli(["list", "--data-mode", "FIXTURE", ...settings()]);
    await cli(["verify", "--output", "--data-mode", "FIXTURE", "--current", ...settings()]);
    await cli(["verify", "--file", output("issues.json")]);
    await cli(["receipt", "--data-mode", "FIXTURE", ...settings(), "--delivered-by", "a", "--received-by", "b", "--received-at", "2026-11-13T06:00:00Z", "--received-sha256", "a".repeat(64)]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe("verify --file", () => {
    it("is OK for a file of fictional data that passes the contract, without a receipt, and shows its SHA-256 first", async () => {
      await cli(exportArguments());
      const result = await cli(["verify", "--file", output("issues.json")]);
      expect(result.code).toBe(0);
      expect(result.lines).toHaveLength(2);
      expect(result.lines[0]).toMatch(/^fileSha256=[0-9a-f]{64}$/u);
      expect(result.lines[1]).toBe("code=VERIFY_OK dataKind=FIXTURE");
    });

    it("is CONTRACT_INVALID for a file that changed after it was written, whatever the kind of change: a value, a field, the version of the contract", async () => {
      await cli(exportArguments());
      const text = await readFile(output("issues.json"), "utf8");
      const changed = {
        value: text.replace("issue-1", "issue-9"),
        field: JSON.stringify({ ...JSON.parse(text), extra: 1 }),
        version: text.replace('"schemaVersion": 1', '"schemaVersion": 2'),
      };
      const expected: Record<string, string> = {
        value: "code=VERIFY_FAILED status=CONTRACT_INVALID detail=CONTENT_HASH",
        field: "code=VERIFY_FAILED status=CONTRACT_INVALID detail=SCHEMA",
        version: "code=VERIFY_FAILED status=CONTRACT_INVALID detail=SCHEMA_VERSION",
      };
      for (const [name, body] of Object.entries(changed)) {
        const path = join(workspace, `${name}.json`);
        await writeFile(path, body);
        const result = await cli(["verify", "--file", path]);
        expect(result.code, name).toBe(1);
        expect(result.lines.at(-1), name).toBe(expected[name]);
      }
    });
  });
});
