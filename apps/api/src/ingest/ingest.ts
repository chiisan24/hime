import {
  IngestRecordSchema,
  ISOInstantSchema,
  SourceManifestRecordSchema,
  isValidIngestSourceId,
  isValidOfficialUrl,
  type IngestRecord,
  type SourceManifestRecord,
} from "@ehime-vote-navigator/contracts";
import {
  sha256Hex,
  type Result,
  type ValidatedRegistry,
} from "@ehime-vote-navigator/domain";

import type { SuppliedSource } from "./sourceSupplier.js";

/** What the developer states about a document; candidates are never guessed. */
export type IngestAssignmentInput =
  | Readonly<{ state: "ASSIGNED"; candidateId: string }>
  | Readonly<{ state: "SHARED" }>
  | Readonly<{ state: "UNASSIGNED" }>;

export type IngestRequest = Readonly<{
  assignment: IngestAssignmentInput;
  electionId: string;
  sourceId: string;
}>;

export type IngestStoreError = Readonly<{
  code: "STORE_READ_FAILED" | "STORE_WRITE_FAILED";
}>;

/** Persistence boundary; the file implementation lives in `ingestStore.ts`. */
export interface IngestStore {
  /** Records of one source in revision order r1..rN (fails on a corrupt store). */
  listRecords(sourceId: string): Promise<Result<readonly IngestRecord[], IngestStoreError>>;
  /** Source IDs that already hold a record with this SHA-256. */
  findSourceIdsBySha256(sha256: string): Promise<Result<readonly string[], IngestStoreError>>;
  /** Stores the raw body content-addressed; resolves to its path below `data/real/raw`. */
  saveRawObject(bytes: Uint8Array): Promise<Result<string, IngestStoreError>>;
  /** Writes the immutable record of one revision. */
  saveRecord(record: IngestRecord): Promise<Result<void, IngestStoreError>>;
}

export const INGEST_REJECTION_CODES = [
  "SOURCE_ID_INVALID",
  "UNKNOWN_ELECTION",
  "UNKNOWN_CANDIDATE",
  "SUPPLY_INCOMPLETE",
  "SOURCE_ELECTION_MISMATCH",
  "DUPLICATE_CONTENT",
  "STORE_READ_FAILED",
  "STORE_WRITE_FAILED",
  "RECORD_INVALID",
] as const;

export type IngestRejectionCode = (typeof INGEST_REJECTION_CODES)[number];

export type IngestRejection = Readonly<{
  code: IngestRejectionCode;
  /** Names of missing or invalid supplied items; never their values. */
  fields?: readonly string[];
  existingSourceId?: string;
  safeMessage: string;
}>;

export type IngestOutcome = Readonly<{
  /** CREATED: a new revision was stored. UNCHANGED: the same bytes were already the latest revision. */
  status: "CREATED" | "UNCHANGED";
  record: IngestRecord;
}>;

export type IngestDecision =
  | Readonly<{ kind: "CREATE"; revision: string }>
  | Readonly<{ kind: "UNCHANGED"; record: IngestRecord }>;

const MESSAGES: Readonly<Record<IngestRejectionCode, string>> = Object.freeze({
  SOURCE_ID_INVALID:
    "The source ID must be 1 to 64 lowercase letters, digits or hyphens and must not be a reserved device name.",
  UNKNOWN_ELECTION: "The election ID is not registered.",
  UNKNOWN_CANDIDATE: "The candidate ID is not defined for this election.",
  SUPPLY_INCOMPLETE:
    "The document body, official URL or retrieved-at time is missing or invalid.",
  SOURCE_ELECTION_MISMATCH: "This source ID already belongs to a different election.",
  DUPLICATE_CONTENT:
    "The same document is already registered under another source ID.",
  STORE_READ_FAILED: "The ingest store could not be read safely.",
  STORE_WRITE_FAILED: "The document could not be saved, so nothing was recorded.",
  RECORD_INVALID: "The ingest record failed validation, so nothing was recorded.",
});

function reject(
  code: IngestRejectionCode,
  extra: Readonly<{ fields?: readonly string[]; existingSourceId?: string }> = {},
): Result<never, IngestRejection> {
  return {
    ok: false,
    error: Object.freeze({
      code,
      safeMessage: MESSAGES[code],
      ...(extra.fields === undefined ? {} : { fields: Object.freeze([...extra.fields]) }),
      ...(extra.existingSourceId === undefined
        ? {}
        : { existingSourceId: extra.existingSourceId }),
    }),
  };
}

function revisionNumber(record: IngestRecord): number {
  return Number(record.revision.slice(1));
}

/**
 * Pure revision decision. The same SHA-256 as the latest revision changes
 * nothing; any other SHA-256 (including a return to older content) becomes the
 * next revision. Earlier revisions are never touched.
 */
export function decideIngest(
  latest: IngestRecord | undefined,
  sha256: string,
): IngestDecision {
  if (latest === undefined) {
    return { kind: "CREATE", revision: "r1" };
  }
  if (latest.sha256 === sha256) {
    return { kind: "UNCHANGED", record: latest };
  }
  return { kind: "CREATE", revision: `r${revisionNumber(latest) + 1}` };
}

function incompleteFields(supplied: SuppliedSource): readonly string[] {
  const candidate = (
    typeof supplied === "object" && supplied !== null ? supplied : {}
  ) as Partial<Record<keyof SuppliedSource, unknown>>;
  const fields: string[] = [];

  if (!(candidate.bytes instanceof Uint8Array) || candidate.bytes.byteLength === 0) {
    fields.push("bytes");
  }
  if (typeof candidate.officialUrl !== "string" || !isValidOfficialUrl(candidate.officialUrl)) {
    fields.push("officialUrl");
  }
  if (
    typeof candidate.retrievedAt !== "string" ||
    !ISOInstantSchema.safeParse(candidate.retrievedAt).success
  ) {
    fields.push("retrievedAt");
  }
  return fields;
}

/**
 * Registers one supplied document. Every rejection happens before anything is
 * written. The body is stored once (content-addressed) and each revision gets
 * one immutable record; supplier kind and ingest time are not recorded, so the
 * same input from any supplier yields the same record.
 */
export async function ingest(
  registry: ValidatedRegistry,
  store: IngestStore,
  supplied: SuppliedSource,
  request: IngestRequest,
): Promise<Result<IngestOutcome, IngestRejection>> {
  if (!isValidIngestSourceId(request.sourceId)) {
    return reject("SOURCE_ID_INVALID");
  }

  const election = registry.elections.find(
    (candidate) => candidate.electionId === request.electionId,
  );
  if (election === undefined) {
    return reject("UNKNOWN_ELECTION");
  }

  if (request.assignment.state === "ASSIGNED") {
    const candidateId = request.assignment.candidateId;
    if (!election.candidates.some((candidate) => candidate.candidateId === candidateId)) {
      return reject("UNKNOWN_CANDIDATE");
    }
  }

  const missing = incompleteFields(supplied);
  if (missing.length > 0) {
    return reject("SUPPLY_INCOMPLETE", { fields: missing });
  }

  const sha256 = sha256Hex(supplied.bytes);

  const listed = await store.listRecords(request.sourceId);
  if (!listed.ok) {
    return reject("STORE_READ_FAILED");
  }
  const latest = listed.value.at(-1);
  if (latest !== undefined && latest.electionId !== request.electionId) {
    return reject("SOURCE_ELECTION_MISMATCH");
  }

  const decision = decideIngest(latest, sha256);
  if (decision.kind === "UNCHANGED") {
    return { ok: true, value: { status: "UNCHANGED", record: decision.record } };
  }

  const holders = await store.findSourceIdsBySha256(sha256);
  if (!holders.ok) {
    return reject("STORE_READ_FAILED");
  }
  const duplicate = holders.value.find((sourceId) => sourceId !== request.sourceId);
  if (duplicate !== undefined) {
    return reject("DUPLICATE_CONTENT", { existingSourceId: duplicate });
  }

  const savedRaw = await store.saveRawObject(supplied.bytes);
  if (!savedRaw.ok) {
    return reject("STORE_WRITE_FAILED");
  }

  const assignment =
    request.assignment.state === "ASSIGNED"
      ? { state: "ASSIGNED", candidateId: request.assignment.candidateId }
      : { state: request.assignment.state };
  const parsed = IngestRecordSchema.safeParse({
    sourceId: request.sourceId,
    electionId: request.electionId,
    revision: decision.revision,
    assignment,
    officialUrl: supplied.officialUrl,
    retrievedAt: supplied.retrievedAt,
    sha256,
    byteLength: supplied.bytes.byteLength,
    rawSnapshotRelativePath: savedRaw.value,
    analysisStatus: "NOT_ANALYZED",
    approvalStatus: "PENDING",
  });
  if (!parsed.success) {
    return reject("RECORD_INVALID");
  }

  const savedRecord = await store.saveRecord(parsed.data);
  if (!savedRecord.ok) {
    return reject("STORE_WRITE_FAILED");
  }

  return { ok: true, value: { status: "CREATED", record: parsed.data } };
}

/** Items only the developer can state; they are never filled in by guessing. */
export type ManifestDraftInput = Readonly<
  Partial<
    Record<
      | "adoptionDecision"
      | "adoptionReason"
      | "adoptionRuleVersion"
      | "electionCorrespondenceEvidence"
      | "issuer"
      | "publishedAt"
      | "sourceType"
      | "title"
      | "usage",
      unknown
    >
  >
>;

export type ManifestDraftError = Readonly<{
  code: "MANIFEST_DRAFT_INVALID";
  /** Names of the invalid or missing top-level items; never their values. */
  fields: readonly string[];
  safeMessage: string;
}>;

const JST_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1000;

function japanStandardDate(instant: string): string {
  return new Date(Date.parse(instant) + JST_OFFSET_MILLISECONDS)
    .toISOString()
    .slice(0, 10);
}

/**
 * Builds a Source Manifest record from an ingest record plus the items the
 * developer supplies (issuer, title, type, publication date, usage review,
 * adoption decision). Nothing is defaulted: an incomplete input is an error.
 */
export function toManifestDraft(
  record: IngestRecord,
  input: ManifestDraftInput,
): Result<SourceManifestRecord, ManifestDraftError> {
  const parsed = SourceManifestRecordSchema.safeParse({
    dataKind: "REAL_AI",
    sourceId: record.sourceId,
    revision: record.revision,
    electionId: record.electionId,
    candidateId:
      record.assignment.state === "ASSIGNED" ? record.assignment.candidateId : null,
    issuer: input.issuer,
    title: input.title,
    sourceType: input.sourceType,
    reference: { kind: "url", url: record.officialUrl },
    rawSnapshotRelativePath: record.rawSnapshotRelativePath,
    publishedAt: input.publishedAt,
    retrievedAt: japanStandardDate(record.retrievedAt),
    usage: input.usage,
    sourceChecksum: record.sha256,
    electionCorrespondenceEvidence: input.electionCorrespondenceEvidence,
    adoptionRuleVersion: input.adoptionRuleVersion,
    adoptionDecision: input.adoptionDecision,
    adoptionReason: input.adoptionReason,
  });

  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  const fields = [
    ...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "record"))),
  ];
  return {
    ok: false,
    error: Object.freeze({
      code: "MANIFEST_DRAFT_INVALID" as const,
      fields: Object.freeze(fields),
      safeMessage: "The Source Manifest draft is incomplete or invalid.",
    }),
  };
}