import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ApprovalLedgerRecordSchema,
  DraftEventSchema,
  DraftRecordSchema,
  FixtureFactSchema,
  IssueCardSchema,
  IssueLinksFileSchema,
  IssueSourceRecordSchema,
} from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

// The input records of the fictional issues (task 16.14). They are fictional: a fictional
// municipality, a fictional document, a fictional value. No real data and no real name is used.

const DIRECTORY = new URL("./", import.meta.url);
const pathOf = (relative: string): string => fileURLToPath(new URL(relative, DIRECTORY));
// A checkout that changes line endings must not change what the tests hash: the records are written with LF.
const readText = (relative: string): string => readFileSync(pathOf(relative), "utf8").replaceAll("\r\n", "\n");
const readJson = (relative: string): unknown => JSON.parse(readText(relative)) as unknown;
const jsonFiles = (relative: string): string[] => readdirSync(pathOf(relative)).filter((name) => name.endsWith(".json")).sort();

const ISSUE_IDS = ["fixture-issue-disaster-v1", "fixture-issue-education-v1", "fixture-issue-population-v1"] as const;
const REAL_NAMES = ["愛媛県", "松山市", "今治市", "新居浜市", "自由民主党", "立憲民主党"] as const;

/** The text of each source before the issues were added. The added sentences come after it and do not change it. */
const ORIGINAL_SOURCE_TEXTS: Readonly<Record<string, string>> = {
  "fixture-source-population-v1":
    "これは架空市あおばの架空資料です。地域の集まりに参加する人が減っているという記録を置きます。地域活動は12件です。",
  "fixture-source-disaster-v1": "これは架空町みなとの架空資料です。避難する場所と避難に必要な情報を確認する取り組みを記録します。避難場所は8か所です。",
  "fixture-source-education-v1": "これは架空村ひなたの架空資料です。子育てについて相談できる時間を設ける取り組みを記録します。子育て相談は6回です。",
};

function sourceText(sourceId: string): string {
  const value = readJson(`./sources/${sourceId}.json`) as { text: string };
  return value.text;
}

describe("the registry of fictional fact items (facts.json)", () => {
  const facts = FixtureFactSchema.array().parse(readJson("./facts.json"));

  it("has the three fact items of the cards, as they are, and four more", () => {
    expect(facts).toHaveLength(7);
    const cards = IssueCardSchema.array().parse(readJson("./cards.json"));
    const ofCards: unknown[] = [];
    for (const card of cards) {
      ofCards.push(...card.facts);
    }
    expect(ofCards).toHaveLength(3);
    expect(facts.slice(0, 3)).toEqual(ofCards);
    expect(new Set(facts.map((fact) => fact.factId)).size).toBe(7);
  });

  it("has a fictional municipality in the area and in the sentence of each added fact, and no real name", () => {
    for (const fact of facts) {
      expect(fact.area).toMatch(/^架空/u);
      expect(fact.sentence).toMatch(/^架空/u);
      for (const name of REAL_NAMES) {
        expect(JSON.stringify(fact)).not.toContain(name);
      }
    }
  });

  it("has the values of the design, and a fact item of each added fact that its source says in the added sentence", () => {
    const byId = new Map(facts.map((fact) => [fact.factId, fact]));
    expect(byId.get("fixture-fact-population-2023-v1")).toMatchObject({ value: { amount: 480, unit: "人" }, surveyDate: 2023 });
    expect(byId.get("fixture-fact-population-2024-v1")).toMatchObject({ value: { amount: 420, unit: "人" }, surveyDate: 2024 });
    expect(byId.get("fixture-fact-disaster-hills-v1")).toMatchObject({ value: { amount: 3, unit: "か所" }, surveyDate: 2025 });
    expect(byId.get("fixture-fact-education-users-v1")).toMatchObject({ value: { amount: 54, unit: "人" }, surveyDate: "2025-09-01" });
    for (const fact of facts.slice(3)) {
      expect(sourceText(fact.fictionalSourceId)).toContain(fact.sentence);
    }
  });

  it("has no derived or computed fact: a fictional fact has no method (Req 7.18)", () => {
    for (const fact of facts) {
      expect(Object.keys(fact)).not.toContain("method");
    }
  });
});

describe("the texts of the fictional sources", () => {
  it("keep every existing sentence as it was, and add only sentences that start with a fictional municipality", () => {
    for (const [sourceId, original] of Object.entries(ORIGINAL_SOURCE_TEXTS)) {
      const text = sourceText(sourceId);
      expect(text.startsWith(original), sourceId).toBe(true);
      const added = text.slice(original.length);
      expect(added.length, sourceId).toBeGreaterThan(0);
      for (const sentence of added.split("。").filter((part) => part !== "")) {
        expect(sentence, sourceId).toMatch(/^架空(市あおば|町みなと|村ひなた)/u);
      }
      for (const name of REAL_NAMES) {
        expect(text).not.toContain(name);
      }
    }
  });
});

describe("the drafts, the events, the issue records and the approvals", () => {
  const drafts = jsonFiles("./drafts/ISSUE_CANDIDATE").map((name) => ({ name, record: DraftRecordSchema.parse(readJson(`./drafts/ISSUE_CANDIDATE/${name}`)) }));
  const events = jsonFiles("./events").map((name) => ({ name, event: DraftEventSchema.parse(readJson(`./events/${name}`)) }));

  it("has three drafts of issue candidates, each named by its own ID, made by a fictional model", () => {
    expect(drafts).toHaveLength(3);
    for (const { name, record } of drafts) {
      expect(name).toBe(`${record.draftId}.json`);
      expect(record).toMatchObject({ dataKind: "FIXTURE", aiClass: "AI_DRAFT", modelId: "fixture-draft-model-v1", inputSources: [] });
      expect(record.key.task).toBe("ISSUE_CANDIDATE");
    }
  });

  it("has an event that the draft was drafted and an event that a person adopted it, for each draft, named by the ID of the event", () => {
    expect(events).toHaveLength(6);
    for (const { name, event } of events) {
      expect(name).toBe(`${event.eventId}.json`);
      expect(event.dataKind).toBe("FIXTURE");
    }
    for (const { record } of drafts) {
      const kinds = events.filter(({ event }) => event.draftId === record.draftId).map(({ event }) => event.kind).sort();
      expect(kinds).toEqual(["DRAFTED", "HUMAN_ADOPTED"]);
    }
  });

  it("has the record of version 1 of each issue, and its facts are in the registry", () => {
    const factIds = new Set(FixtureFactSchema.array().parse(readJson("./facts.json")).map((fact) => fact.factId));
    for (const issueId of ISSUE_IDS) {
      expect(jsonFiles(`./issues/${issueId}`)).toEqual(["v1.json"]);
      const record = IssueSourceRecordSchema.parse(readJson(`./issues/${issueId}/v1.json`));
      expect(record).toMatchObject({ issueId, version: 1, dataKind: "FIXTURE" });
      expect(record.provenance).toMatchObject({ aiInvolvement: "AI_DRAFT", modelId: "fixture-draft-model-v1", humanEdited: false });
      expect(drafts.some(({ record: draft }) => draft.draftId === record.provenance.draftId)).toBe(true);
      for (const factId of record.basisFactIds) {
        expect(factIds.has(factId), factId).toBe(true);
      }
      expect(record.statement).toMatch(/^架空/u);
    }
  });

  it("has one approval of each issue by the fictional approver, with the six confirmations, named by the SHA-256 of the file", () => {
    for (const issueId of ISSUE_IDS) {
      const names = jsonFiles(`./approvals/ISSUE/${issueId}`);
      expect(names).toHaveLength(1);
      const [name = ""] = names;
      const text = readText(`./approvals/ISSUE/${issueId}/${name}`);
      const record = ApprovalLedgerRecordSchema.parse(JSON.parse(text));
      expect(name).toBe(`${createHash("sha256").update(text, "utf8").digest("hex")}.json`);
      expect(record).toMatchObject({
        type: "APPROVE",
        targetKind: "ISSUE",
        targetId: issueId,
        targetVersion: 1,
        approverId: "fixture-issue-approver-v1",
        approvedAt: "2026-01-04T09:00:00.000Z",
        issueChecks: {
          factsMatch: true,
          factAndHypothesisSeparated: true,
          noCausalClaim: true,
          noRecommendation: true,
          unknownsStated: true,
          sourcesShown: true,
        },
      });
      const issue = IssueSourceRecordSchema.parse(readJson(`./issues/${issueId}/v1.json`));
      const issueText = readText(`./issues/${issueId}/v1.json`);
      expect(issue.issueId).toBe(issueId);
      if (record.type === "APPROVE") {
        expect(record.targetHash).toBe(createHash("sha256").update(issueText, "utf8").digest("hex"));
      }
    }
  });
});

describe("the record of links", () => {
  it("is a record of fictional data with no link: the existing questions and cards are not changed", () => {
    const links = IssueLinksFileSchema.parse(readJson("./issue-links.json"));
    expect(links).toEqual({ schemaVersion: 1, dataKind: "FIXTURE", links: [] });
  });
});

describe("the fictional files that already existed", () => {
  it("do not name a real municipality or party in the files that this task added", () => {
    const added = [
      "./facts.json",
      "./issue-links.json",
      ...ISSUE_IDS.map((id) => `./issues/${id}/v1.json`),
      ...jsonFiles("./drafts/ISSUE_CANDIDATE").map((name) => `./drafts/ISSUE_CANDIDATE/${name}`),
    ];
    for (const path of added) {
      for (const name of REAL_NAMES) {
        expect(readText(path), path).not.toContain(name);
      }
    }
  });
});
