import { ISSUES_SCHEMA_VERSION, IssuesFileSchema, THEME_IDS } from "@ehime-vote-navigator/contracts";
import type { DataKind, IssuesFile, Sha256 } from "@ehime-vote-navigator/contracts";
import { calculateContentHash, encodePortableCanonicalJson } from "@ehime-vote-navigator/domain";

import { fail, succeed } from "../draft/types.js";
import type { Outcome } from "../draft/types.js";
import type { IssueSnapshot } from "./loadIssueSnapshot.js";

/**
 * The file `issues.json` (Req 13.1 to 13.4): how it is made from the issues that are valid now, how
 * it is written as bytes, and how a text is verified before it is used. It is for Node, not for the
 * browser: the browser entry has no `issues.json` and no verifier of it (the file is not public).
 */

export type IssuesFileSource = Readonly<{
  snapshot: Pick<IssueSnapshot, "issues" | "withdrawn" | "inputDigest">;
  dataKind: DataKind;
  generatedAt: string;
}>;

/**
 * Makes the file of a snapshot and checks it with the contract. The same snapshot and the same time
 * give the same bytes. `CONTRACT_INVALID` when the file is not valid (an issue of the other data kind
 * is one such case: the file does not mix the two kinds).
 */
export async function buildIssuesFile(source: IssuesFileSource): Promise<Outcome<IssuesFile, Readonly<{ code: "CONTRACT_INVALID" }>>> {
  const body = {
    meta: {
      schemaVersion: ISSUES_SCHEMA_VERSION,
      kind: "ISSUES" as const,
      dataKind: source.dataKind,
      generatedAt: source.generatedAt,
      inputDigest: source.snapshot.inputDigest,
    },
    issues: [...source.snapshot.issues],
    withdrawn: [...source.snapshot.withdrawn],
    coverage: THEME_IDS.map((themeId) => ({
      themeId,
      issueCount: source.snapshot.issues.filter((issue) => issue.themeId === themeId).length,
    })),
  };
  const contentHash = await calculateContentHash(body);
  const parsed = IssuesFileSchema.safeParse({ ...body, meta: { ...body.meta, contentHash } });
  return parsed.success ? succeed(parsed.data) : fail({ code: "CONTRACT_INVALID" });
}

/** The bytes of the file: the portable canonical JSON, so the same file gives the same bytes. */
export function serializeIssuesFile(file: IssuesFile): Uint8Array {
  return encodePortableCanonicalJson(file);
}

export const ISSUES_VERIFICATION_CODES = ["CONTRACT_INVALID", "STALE"] as const;

/** Which check of the verification the text did not pass. A fixed code only: never a part of the text. */
export const ISSUES_VERIFICATION_DETAILS = ["SCHEMA", "SCHEMA_VERSION", "CONTENT_HASH", "INPUT_DIGEST"] as const;

export type IssuesVerification =
  | Readonly<{ ok: true; file: IssuesFile }>
  | Readonly<{
      ok: false;
      code: (typeof ISSUES_VERIFICATION_CODES)[number];
      detail: (typeof ISSUES_VERIFICATION_DETAILS)[number];
    }>;

function refused(
  code: (typeof ISSUES_VERIFICATION_CODES)[number],
  detail: (typeof ISSUES_VERIFICATION_DETAILS)[number],
): IssuesVerification {
  return { ok: false, code, detail };
}

/**
 * Verifies the text of an `issues.json`. In this order: the contract and the version of the
 * contract (`meta.schemaVersion` is the version that is current), the `contentHash`, and, when the
 * input as it is now is given, the `inputDigest`. The first check that fails is the result:
 * `CONTRACT_INVALID` for the first two, `STALE` for the last (the file is right, and it was made
 * from an input that is not the input now). It reads only the text and calls nothing.
 */
export async function verifyIssuesText(text: string, options: Readonly<{ currentInputDigest?: Sha256 }> = {}): Promise<IssuesVerification> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return refused("CONTRACT_INVALID", "SCHEMA");
  }
  const meta = typeof json === "object" && json !== null ? (json as { meta?: unknown }).meta : undefined;
  const version = typeof meta === "object" && meta !== null ? (meta as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (version !== ISSUES_SCHEMA_VERSION) {
    return refused("CONTRACT_INVALID", typeof version === "number" ? "SCHEMA_VERSION" : "SCHEMA");
  }
  const parsed = IssuesFileSchema.safeParse(json);
  if (!parsed.success) {
    return refused("CONTRACT_INVALID", "SCHEMA");
  }
  if ((await calculateContentHash(parsed.data)) !== parsed.data.meta.contentHash) {
    return refused("CONTRACT_INVALID", "CONTENT_HASH");
  }
  if (options.currentInputDigest !== undefined && options.currentInputDigest !== parsed.data.meta.inputDigest) {
    return refused("STALE", "INPUT_DIGEST");
  }
  return { ok: true, file: parsed.data };
}
