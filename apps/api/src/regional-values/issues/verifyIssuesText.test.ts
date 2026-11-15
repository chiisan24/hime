import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { IssuesFileSchema, Sha256Schema, THEME_IDS } from "@ehime-vote-navigator/contracts";
import type { IssuesFile } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { buildIssuesFile, serializeIssuesFile, verifyIssuesText } from "./issuesFile.js";

// The text that is checked is the sample of fictional data (the output of `issues export`), changed in one place at a time.

const SAMPLE = readFileSync(fileURLToPath(new URL("../../../../../packages/fixtures/src/regional-values/issues.json", import.meta.url)), "utf8").replaceAll(
  "\r\n",
  "\n",
);
const FILE = IssuesFileSchema.parse(JSON.parse(SAMPLE));
const OTHER_DIGEST = Sha256Schema.parse("0".repeat(64));

type Json = Record<string, unknown>;

/** The sample as a text, after `edit` changed it. */
function changed(edit: (value: Json) => void): string {
  const value = JSON.parse(SAMPLE) as Json;
  edit(value);
  return JSON.stringify(value);
}

const metaOf = (value: Json): Json => value.meta as Json;
const firstIssueOf = (value: Json): Json => (value.issues as Json[])[0] ?? {};

const INVALID_SCHEMA = { ok: false, code: "CONTRACT_INVALID", detail: "SCHEMA" } as const;
const INVALID_HASH = { ok: false, code: "CONTRACT_INVALID", detail: "CONTENT_HASH" } as const;

describe("verifyIssuesText", () => {
  it("accepts the sample, the text of a file that the export wrote", async () => {
    expect(await verifyIssuesText(SAMPLE)).toEqual({ ok: true, file: FILE });
  });

  it("refuses a text that is not JSON, and a JSON that is not the contract, with the code of the contract (SCHEMA)", async () => {
    for (const text of ["", "{ not json", "null", "[]", "42", JSON.stringify({ meta: {} })]) {
      expect(await verifyIssuesText(text), text).toEqual(INVALID_SCHEMA);
    }
  });

  it("refuses a field that the contract does not have, and a value that the contract does not take (SCHEMA)", async () => {
    expect(
      await verifyIssuesText(
        changed((value) => {
          value.extra = true;
        }),
      ),
    ).toEqual(INVALID_SCHEMA);
    expect(
      await verifyIssuesText(
        changed((value) => {
          firstIssueOf(value).rank = 1;
        }),
      ),
    ).toEqual(INVALID_SCHEMA);
    expect(
      await verifyIssuesText(
        changed((value) => {
          value.withdrawn = [{ issueId: "x", version: 1, reason: "OTHER" }];
        }),
      ),
    ).toEqual(INVALID_SCHEMA);
    expect(
      await verifyIssuesText(
        changed((value) => {
          metaOf(value).dataKind = "REAL_AI";
        }),
      ),
    ).toMatchObject({ ok: false, code: "CONTRACT_INVALID" });
  });

  it("refuses a version of the contract that is not the current one (SCHEMA_VERSION), and a version that is not a number (SCHEMA)", async () => {
    for (const version of [0, 2, 99]) {
      const text = changed((value) => {
        metaOf(value).schemaVersion = version;
      });
      expect(await verifyIssuesText(text), String(version)).toEqual({ ok: false, code: "CONTRACT_INVALID", detail: "SCHEMA_VERSION" });
    }
    const text = changed((value) => {
      metaOf(value).schemaVersion = "1";
    });
    expect(await verifyIssuesText(text)).toEqual(INVALID_SCHEMA);
  });

  it("refuses a file whose content was changed after the hash was made, or whose hash was changed (CONTENT_HASH)", async () => {
    const contentChanged = changed((value) => {
      firstIssueOf(value).title = "別の題";
    });
    expect(await verifyIssuesText(contentChanged)).toEqual(INVALID_HASH);
    const hashChanged = changed((value) => {
      metaOf(value).contentHash = OTHER_DIGEST;
    });
    expect(await verifyIssuesText(hashChanged)).toEqual(INVALID_HASH);
    // The time of the file is part of what the hash covers.
    const timeChanged = changed((value) => {
      metaOf(value).generatedAt = "2026-01-05T09:00:00Z";
    });
    expect(await verifyIssuesText(timeChanged)).toEqual(INVALID_HASH);
  });

  it("is STALE, not invalid, for a file that is right but was made from another input; and only when the current input is given", async () => {
    expect(await verifyIssuesText(SAMPLE, { currentInputDigest: FILE.meta.inputDigest })).toMatchObject({ ok: true });
    expect(await verifyIssuesText(SAMPLE, { currentInputDigest: OTHER_DIGEST })).toEqual({ ok: false, code: "STALE", detail: "INPUT_DIGEST" });
    expect(await verifyIssuesText(SAMPLE)).toMatchObject({ ok: true });
  });

  it("checks the contract first, then the hash, then the input: a file that is not valid is not called stale", async () => {
    const broken = changed((value) => {
      value.extra = true;
    });
    expect(await verifyIssuesText(broken, { currentInputDigest: OTHER_DIGEST })).toEqual(INVALID_SCHEMA);
    const hashed = changed((value) => {
      metaOf(value).contentHash = OTHER_DIGEST;
    });
    expect(await verifyIssuesText(hashed, { currentInputDigest: OTHER_DIGEST })).toEqual(INVALID_HASH);
  });

  it("returns a fixed code and detail only: no value of the text", async () => {
    const result = await verifyIssuesText(
      changed((value) => {
        firstIssueOf(value).title = "秘密の題";
      }),
    );
    expect(JSON.stringify(result)).not.toContain("秘密");
  });
});

describe("buildIssuesFile", () => {
  const snapshot = { issues: FILE.issues, withdrawn: FILE.withdrawn, inputDigest: FILE.meta.inputDigest };

  async function build(over: Partial<{ dataKind: "FIXTURE" | "REAL_AI"; generatedAt: string }> = {}): Promise<IssuesFile | null> {
    const built = await buildIssuesFile({ snapshot, dataKind: "FIXTURE", generatedAt: "2026-01-04T09:00:00Z", ...over });
    return built.ok ? built.value : null;
  }

  it("makes the sample again from its issues, to the last byte, and the text is accepted by the verifier", async () => {
    const file = await build();
    expect(file).toEqual(FILE);
    const text = new TextDecoder().decode(serializeIssuesFile(file ?? FILE));
    expect(text).toBe(SAMPLE);
    expect(await verifyIssuesText(text)).toMatchObject({ ok: true });
  });

  it("lists the six themes in the order of their definition, with the number of the issues of each", async () => {
    const file = await build();
    expect(file?.coverage.map((entry) => entry.themeId)).toEqual([...THEME_IDS]);
    expect(file?.coverage.reduce((sum, entry) => sum + entry.issueCount, 0)).toBe(FILE.issues.length);
  });

  it("gives another content hash for another time, and the same input digest", async () => {
    const first = await build();
    const second = await build({ generatedAt: "2026-01-05T09:00:00Z" });
    expect(second?.meta.contentHash).not.toBe(first?.meta.contentHash);
    expect(second?.meta.inputDigest).toBe(first?.meta.inputDigest);
  });

  it("refuses to mix the kinds: the issues of fictional data are not a file of real data (CONTRACT_INVALID)", async () => {
    expect(await buildIssuesFile({ snapshot, dataKind: "REAL_AI", generatedAt: "2026-01-04T09:00:00Z" })).toEqual({ ok: false, error: { code: "CONTRACT_INVALID" } });
  });

  it("refuses an issue that is both in the issues and withdrawn, and a time that is not a time", async () => {
    const first = FILE.issues[0];
    expect(first).toBeDefined();
    const both = { ...snapshot, withdrawn: [{ issueId: first?.issueId ?? "", version: 1, reason: "REVOKED" as const }] };
    expect(await buildIssuesFile({ snapshot: both, dataKind: "FIXTURE", generatedAt: "2026-01-04T09:00:00Z" })).toMatchObject({ ok: false });
    expect(await buildIssuesFile({ snapshot, dataKind: "FIXTURE", generatedAt: "yesterday" })).toMatchObject({ ok: false });
  });
});
