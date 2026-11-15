import { existsSync, readFileSync } from "node:fs";

import * as regional from "../../packages/contracts/src/models/regional/index.js";
import * as browser from "../../packages/domain/src/regional-values/browser.js";
import { describe, expect, it } from "vitest";

import { OUTPUT_STATUSES } from "../../apps/api/src/regional-values/issues/exportIssues.js";
import { ISSUES_VERIFICATION_DETAILS } from "../../apps/api/src/regional-values/issues/issuesFile.js";
import { RECEIPT_CHECK_STATUSES } from "../../apps/api/src/regional-values/issues/receipt.js";
import { repoPath } from "../harness/regional-values/importGraph.js";

// Feature: regional-values-map, 16.10: 課題情報の受け渡し手引きが、契約、符号、コマンドに追随していること（10.3と同じ方式）

const GUIDE = readFileSync(repoPath(".kiro", "specs", "regional-values-map", "issue-handoff-guide.md"), "utf8");
const SAMPLE = JSON.parse(readFileSync(repoPath("packages", "fixtures", "src", "regional-values", "issues.json"), "utf8")) as {
  meta: Record<string, unknown>;
  issues: Record<string, unknown>[];
  withdrawn: unknown[];
  coverage: Record<string, unknown>[];
};

function sectionOf(headingPattern: RegExp): string {
  const lines = GUIDE.split("\n");
  const start = lines.findIndex((line) => line.startsWith("## ") && headingPattern.test(line));
  if (start < 0) {
    throw new Error(`The guide has no section for ${String(headingPattern)}`);
  }
  const length = lines.slice(start + 1).findIndex((line) => line.startsWith("## "));
  return lines.slice(start, length < 0 ? lines.length : start + 1 + length).join("\n");
}

const mentioned = (text: string, name: string): boolean => text.includes(`\`${name}\``);
const missingFrom = (text: string, names: readonly string[]): string[] => names.filter((name) => !mentioned(text, name));

describe("the issue handoff guide: the contract", () => {
  const section = sectionOf(/契約の読み方/);

  it("names each contract, its type and its schema, and the schemas are the ones that the contracts export", () => {
    const names = [
      "IssuesFile",
      "ApprovedIssue",
      "WithdrawnIssue",
      "IssueLinksFile",
      "IssuesReceipt",
      "IssuesExportReport",
    ];
    expect(missingFrom(section, names)).toEqual([]);
    expect(missingFrom(section, names.map((name) => `${name}Schema`))).toEqual([]);
    for (const name of names) {
      expect(`${name}Schema` in regional, `${name}Schema`).toBe(true);
    }
  });

  it("says the version of the contract, which is the version that is current", () => {
    expect(section).toContain("`ISSUES_SCHEMA_VERSION`");
    expect(section).toContain(`\`${regional.ISSUES_SCHEMA_VERSION}\``);
    expect(regional.ISSUES_SCHEMA_VERSION).toBe(1);
  });

  it("says that the types are used with import type, from the entry of the contracts for the browser", () => {
    expect(GUIDE).toContain("import type");
    expect(GUIDE).toContain("@ehime-vote-navigator/contracts/regional");
  });

  it("says that the verifier of issues.json is not in the entry of the browser, and it is not", () => {
    expect(section).toContain("`verifyIssuesText`");
    expect(Object.keys(browser)).not.toContain("verifyIssuesText");
    for (const name of ["loadIssueSnapshot", "checkIssueLinks", "applyIssueValidity", "buildIssuesFile"]) {
      expect(Object.keys(browser), name).not.toContain(name);
    }
  });

  it("mentions every field of the file, of an approved issue and of its parts, as the sample (which the contract accepts) has them", () => {
    const issue = SAMPLE.issues[0] ?? {};
    const keys = new Set<string>([
      ...Object.keys(SAMPLE),
      ...Object.keys(SAMPLE.meta),
      ...Object.keys(issue),
      ...Object.keys((issue.approval as Record<string, unknown>) ?? {}),
      ...Object.keys((issue.provenance as Record<string, unknown>) ?? {}),
      ...Object.keys(((issue.factSummary as Record<string, unknown>[])[0]) ?? {}),
      ...Object.keys(((issue.responseDirections as Record<string, unknown>[])[0]) ?? {}),
      ...Object.keys(SAMPLE.coverage[0] ?? {}),
      "reason",
    ]);
    expect(keys.size).toBeGreaterThan(25);
    expect(missingFrom(section, [...keys])).toEqual([]);
  });

  it("mentions every field of a link of the record of links", () => {
    const parsed = regional.IssueLinksFileSchema.parse({
      schemaVersion: 1,
      dataKind: "FIXTURE",
      links: [{ targetKind: "QUESTION", targetId: "q", issueId: "i", issueVersion: 1 }],
    });
    const link = parsed.links[0] ?? {};
    expect(missingFrom(GUIDE, [...Object.keys(parsed), ...Object.keys(link)])).toEqual([]);
    expect(GUIDE).toContain("`QUESTION`");
    expect(GUIDE).toContain("`ISSUE_CARD`");
  });

  it("says that a direction is for reference, and that the facts are not written in a question", () => {
    expect(GUIDE).toContain("`REFERENCE_ONLY`");
    expect(GUIDE).toContain("`NO_FACT_NUMBERS`");
  });
});

describe("the issue handoff guide: the commands", () => {
  it("names each command with the options that it takes", () => {
    for (const text of [
      "issues export",
      "issues list",
      "issues verify --output",
      "issues verify --file",
      "issues receipt",
      "--data-mode",
      "--generated-at",
      "--draft-settings",
      "--config-dir",
      "--current",
      "--delivered-by",
      "--received-by",
      "--received-at",
      "--received-sha256",
    ]) {
      expect(GUIDE, text).toContain(text);
    }
  });

  it("gives the command that makes the sample, with the time and the settings that the test uses", () => {
    expect(GUIDE).toContain(
      "issues export --data-mode FIXTURE --generated-at 2026-01-04T09:00:00Z --config-dir tests/harness/regional-values/test-config --draft-settings tests/harness/regional-values/test-config/draft-settings.json",
    );
    expect(SAMPLE.meta.generatedAt).toBe("2026-01-04T09:00:00Z");
  });

  it("states the codes of a failed export, as the contract and the command have them", () => {
    const section = sectionOf(/出力の手順/);
    expect(section).toContain("`EXPORT_STATE_NOT_RECORDED`");
    expect(section).toContain("`EXPORT_STATE_NOT_FINALIZED`");
    for (const code of regional.EXPORT_FAILURE_CODES) {
      expect(section, code).toContain(`reason=${code}`);
    }
    expect(section).toContain("`INVALIDATED`");
  });
});

describe("the issue handoff guide: what may be used", () => {
  const section = sectionOf(/使う前の検査/);

  it("states each state of an output and each detail of a contract that is not met", () => {
    expect(missingFrom(section, OUTPUT_STATUSES)).toEqual([]);
    expect(missingFrom(section, ISSUES_VERIFICATION_DETAILS.filter((detail) => detail !== "INPUT_DIGEST"))).toEqual([]);
  });

  it("states each result of a file against the receipts, and that only a file that is OK may be used", () => {
    expect(missingFrom(section, RECEIPT_CHECK_STATUSES.filter((status) => status !== "OK"))).toEqual([]);
    expect(section).toContain("受領記録との照合が済むまで使えません");
    expect(section).toContain("(i-13)");
  });
});

describe("the issue handoff guide: withdrawn issues and the record of links", () => {
  it("states each of the reasons that an issue is withdrawn, in the order of precedence", () => {
    const section = sectionOf(/無効になった課題と再承認/);
    expect(missingFrom(section, regional.WITHDRAWN_REASONS)).toEqual([]);
    const positions = regional.WITHDRAWN_REASONS.map((reason) => section.indexOf(`\`${reason}\``));
    expect([...positions].sort((first, second) => first - second)).toEqual(positions);
    expect(section).toContain("`issues` にも `withdrawn` にも入りません");
  });

  it("tells QUESTION_ISSUE_INVALID from CONTRACT_VIOLATION, and what happens to a card", () => {
    const section = sectionOf(/質問との接続/);
    expect(section).toContain("`QUESTION_ISSUE_INVALID`");
    expect(section).toContain("`CONTRACT_VIOLATION`");
    expect(section).toContain("`PENDING`");
    expect(regional.GATE_REASON_CODES).toContain("QUESTION_ISSUE_INVALID");
    expect(regional.GATE_REASON_CLASS.QUESTION_ISSUE_INVALID).toBe("SHORTAGE");
    expect(regional.GATE_REASON_CLASS.CONTRACT_VIOLATION).toBe("DEFECT");
    expect(section).toContain("不足");
    expect(section).toContain("欠陥");
  });
});

describe("the issue handoff guide: the delivery of real data", () => {
  const section = sectionOf(/実データの受け渡し経路/);

  it("says that the file is not kept in Git, and that the receipt is, and that its people and time are self-reported", () => {
    expect(section).toContain("Git管理外");
    expect(section).toContain("issues-receipts");
    expect(section).toContain("`SELF_REPORTED`");
    expect(section).toContain("自己申告");
    expect(section).toContain("`issues verify --file");
  });

  it("names the receipt that the contract has: dataKind REAL_AI, and no text of an issue", () => {
    const receipt = regional.IssuesReceiptSchema.shape;
    expect(Object.keys(receipt)).not.toContain("issues");
    expect(Object.keys(receipt)).toEqual(expect.arrayContaining(["fileSha256", "contentHash", "inputDigest", "generatedAt", "issuesSchemaVersion", "attestation"]));
    expect(section).toContain("本文を含みません");
  });
});

describe("the issue handoff guide: the files that it names", () => {
  it("refers only to files that exist in the repository", () => {
    const paths = [...GUIDE.matchAll(/`([A-Za-z0-9_.\-/]+\.(?:ts|tsx|json|md|mjs))`/g)]
      .map((match) => match[1] ?? "")
      .filter((path) => path.includes("/") && !path.startsWith("/") && !path.startsWith("dist/") && !path.startsWith("data/"));
    expect(paths.length).toBeGreaterThan(2);
    expect(paths.filter((path) => !existsSync(repoPath(...path.split("/"))))).toEqual([]);
  });

  it("refers to the files that the guide of the screen is in, as the guide that goes with this one", () => {
    expect(GUIDE).toContain("`ui-integration-guide.md`");
    expect(existsSync(repoPath(".kiro", "specs", "regional-values-map", "ui-integration-guide.md"))).toBe(true);
  });
});
