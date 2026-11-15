import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { IssuesReceiptSchema, Sha256Schema } from "@ehime-vote-navigator/contracts";
import type { IssuesReceipt, Sha256 } from "@ehime-vote-navigator/contracts";

import { hashOf } from "../draft/approvalLedger.js";
import { writeImmutableRecord } from "../draft/draftStore.js";
import { fail, succeed } from "../draft/types.js";
import type { Outcome } from "../draft/types.js";
import { verifyOutput } from "./exportIssues.js";
import type { ExportFileOperations, OutputPlace } from "./exportIssues.js";

/**
 * The receipt of an `issues.json` of real data (Req 13.11, design: 実データの受け渡し経路). It is
 * kept in Git and has no text of an issue. The person who handed the file over, the person who
 * received it and the time are what the command was told: they are self-reported, with the fixed
 * value `attestation: "SELF_REPORTED"`, and are not a proof of who the persons are (D32). What the
 * receipt can check is the file: its SHA-256, its content hash, the input it was made from, the time
 * it was made and the version of its contract.
 */

/** Where the receipts are, relative to the repository root. They are kept in Git. */
export const RECEIPT_DIRECTORY = ".kiro/specs/regional-values-map/records/issues-receipts";

export type ReceiptRequest = Readonly<{
  deliveredBy: string;
  receivedBy: string;
  receivedAt: string;
  /** The SHA-256 of the file that the receiver has, which the receiver told. */
  receivedSha256: string;
}>;

export const RECEIPT_REFUSALS = [
  "DATA_KIND_NOT_ALLOWED",
  "ARGUMENT_INVALID",
  "OUTPUT_NOT_OK",
  "SHA256_MISMATCH",
  "WRITE_FAILED",
] as const;

export type ReceiptRefusal = (typeof RECEIPT_REFUSALS)[number];

export type ReceiptOutcome = Outcome<
  Readonly<{ receipt: IssuesReceipt; state: "created" | "already-present" }>,
  Readonly<{ code: ReceiptRefusal; outputStatus?: string }>
>;

/**
 * Writes the receipt of the output of real data. It writes nothing unless the output is valid and
 * made from the input as it is now (`OK` with the digest of the current input), and the SHA-256
 * that the receiver told is the SHA-256 of the output. The receipt is an immutable file named by
 * the SHA-256 of its own content, so the same receipt written again is the same file.
 */
export async function createReceipt(
  place: OutputPlace,
  request: ReceiptRequest,
  options: Readonly<{ currentInputDigest: Sha256; receiptDirectory: string; operations?: ExportFileOperations }>,
): Promise<ReceiptOutcome> {
  if (place.dataKind !== "REAL_AI") {
    // A fictional sample is in Git as it is, so it has no receipt.
    return fail({ code: "DATA_KIND_NOT_ALLOWED" });
  }
  const told = Sha256Schema.safeParse(request.receivedSha256);
  if (!told.success) {
    return fail({ code: "ARGUMENT_INVALID" });
  }
  const verification = await verifyOutput(place, {
    currentInputDigest: options.currentInputDigest,
    ...(options.operations === undefined ? {} : { operations: options.operations }),
  });
  const { state } = verification;
  if (verification.status !== "OK" || state === null || state.output === null) {
    return fail({ code: "OUTPUT_NOT_OK", outputStatus: verification.status });
  }
  if (told.data !== state.output.fileSha256) {
    return fail({ code: "SHA256_MISMATCH" });
  }
  const parsed = IssuesReceiptSchema.safeParse({
    schemaVersion: 1,
    kind: "ISSUES_RECEIPT",
    dataKind: "REAL_AI",
    issuesSchemaVersion: state.output.issuesSchemaVersion,
    generatedAt: state.output.generatedAt,
    fileSha256: state.output.fileSha256,
    contentHash: state.output.contentHash,
    inputDigest: state.output.inputDigest,
    issueCount: state.output.issueCount,
    withdrawnCount: state.output.withdrawnCount,
    deliveredBy: request.deliveredBy,
    receivedBy: request.receivedBy,
    receivedAt: request.receivedAt,
    attestation: "SELF_REPORTED",
  });
  if (!parsed.success) {
    return fail({ code: "ARGUMENT_INVALID" });
  }
  const written = await writeImmutableRecord(
    { dataKind: "REAL_AI", rootDir: options.receiptDirectory, logicalRoot: RECEIPT_DIRECTORY },
    `${hashOf(parsed.data)}.json`,
    parsed.data,
  );
  return written.ok ? succeed({ receipt: parsed.data, state: written.value }) : fail({ code: "WRITE_FAILED" });
}

// ---------------------------------------------------------------------------
// Checking a file that was received
// ---------------------------------------------------------------------------

/** What a file that was received can be against the receipts. Only `OK` says that the file may be used. */
export const RECEIPT_CHECK_STATUSES = ["OK", "RECEIPT_MISSING", "RECEIPT_MISMATCH", "RECEIPT_INVALID", "RECEIPT_LATEST_UNDECIDED"] as const;

export type ReceiptCheck = Readonly<{ status: (typeof RECEIPT_CHECK_STATUSES)[number] }>;

/** The receipts of real data, in the order of their names. `null` when a file is not a receipt, or is not named by its own SHA-256. */
export async function readReceipts(receiptDirectory: string): Promise<readonly IssuesReceipt[] | null> {
  let names: string[];
  try {
    names = (await readdir(receiptDirectory)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT" ? [] : null;
  }
  const receipts: IssuesReceipt[] = [];
  for (const name of names) {
    try {
      const parsed = IssuesReceiptSchema.safeParse(JSON.parse(await readFile(join(receiptDirectory, name), "utf8")));
      if (!parsed.success || name !== `${hashOf(parsed.data)}.json`) {
        return null;
      }
      receipts.push(parsed.data);
    } catch {
      return null;
    }
  }
  return receipts;
}

export type ReceivedFile = Readonly<{
  fileSha256: Sha256;
  contentHash: Sha256;
  inputDigest: Sha256;
  generatedAt: string;
  issuesSchemaVersion: number;
}>;

/**
 * Checks a file of real data that was received against the receipt: the five items of the file
 * (the SHA-256 of the whole file, the content hash, the digest of the input, the time it was made
 * and the version of its contract) are those of the receipt.
 *
 * Which receipt is the latest one is not decided yet (the open decision (i-13): a time cannot say
 * which of two receipts is the later, and the contract has no field that says it). Until it is
 * decided, this does not pick one: with no receipt it is `RECEIPT_MISSING`; with one receipt that
 * receipt is the one; with more than one it is `RECEIPT_LATEST_UNDECIDED`, a refusal, so that a
 * file that an older receipt names is never accepted by choosing a receipt by a guess.
 */
export function checkAgainstReceipts(file: ReceivedFile, receipts: readonly IssuesReceipt[] | null): ReceiptCheck {
  if (receipts === null) {
    return { status: "RECEIPT_INVALID" };
  }
  const [only, ...others] = receipts;
  if (only === undefined) {
    return { status: "RECEIPT_MISSING" };
  }
  if (others.length > 0) {
    return { status: "RECEIPT_LATEST_UNDECIDED" };
  }
  const same =
    only.fileSha256 === file.fileSha256 &&
    only.contentHash === file.contentHash &&
    only.inputDigest === file.inputDigest &&
    only.generatedAt === file.generatedAt &&
    only.issuesSchemaVersion === file.issuesSchemaVersion;
  return same ? { status: "OK" } : { status: "RECEIPT_MISMATCH" };
}
