import type { RealSource } from "@ehime-vote-navigator/contracts";
import { sha256Hex } from "@ehime-vote-navigator/domain";

import { succeed } from "../draft/types.js";
import type { Outcome } from "../draft/types.js";
import { createFileIssueInputs } from "../issues/inputs.js";
import { currentShaOf } from "../issues/loadIssueSnapshot.js";
import { readRawFiles } from "./sourceRecords.js";
import type { ReadFailure } from "./sourceRecords.js";
import type { IntakeStore } from "./storeLayout.js";

export { sourceOf } from "../issues/loadIssueSnapshot.js";

/**
 * The SHA-256 of each original as it is now, by the SHA-256 that a record has: `undefined` when the original cannot be looked at,
 * and another value when the file changed. It is the same look that `loadIssueSnapshot` takes before it judges an issue, so a
 * fact item and an issue are judged by the same original. It only reads.
 */
export async function currentOriginalShas(store: IntakeStore, sources: readonly RealSource[]): Promise<ReadonlyMap<string, string | undefined>> {
  const inputs = createFileIssueInputs(store.root, { rawRoot: store.rawRoot });
  const current = new Map<string, string | undefined>();
  const ordered = [...sources].sort((first, second) => {
    const left = `${first.sourceId}\u0000${first.revision}`;
    const right = `${second.sourceId}\u0000${second.revision}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  for (const source of ordered) {
    const now = currentShaOf(source, await inputs.originalHashes(source));
    const earlier = current.get(source.sha256);
    // The same content may be held by two revisions of one source; it is unchanged if any of them still has it.
    current.set(source.sha256, earlier === source.sha256 ? earlier : now);
  }
  return current;
}

// ---------------------------------------------------------------------------
// The look at the originals (the command `real original ...`)
// ---------------------------------------------------------------------------

export type ExpectedOriginal = Readonly<{ sha256: string; byteLength: number }>;

/** What a file is, and whether it is the file that a person expects: the SHA-256 and the size, each compared on its own. */
export type OriginalComparison = Readonly<{
  sha256: string;
  byteLength: number;
  sha256Matches: boolean;
  byteLengthMatches: boolean;
  matches: boolean;
}>;

/** Compares the bytes of a file with the SHA-256 and the size that a person expects. A pure function: it opens no file. */
export function compareWithExpected(bytes: Uint8Array, expected: ExpectedOriginal): OriginalComparison {
  const sha256 = sha256Hex(bytes);
  const sha256Matches = sha256 === expected.sha256;
  const byteLengthMatches = bytes.byteLength === expected.byteLength;
  return { sha256, byteLength: bytes.byteLength, sha256Matches, byteLengthMatches, matches: sha256Matches && byteLengthMatches };
}

export const STORED_ORIGINAL_STATES = ["MATCH", "CHANGED", "MISSING"] as const;

export type StoredOriginalState = (typeof STORED_ORIGINAL_STATES)[number];

/** One source record and the file of its original as it is now. `current` and `byteLength` are `null` when there is no file to look at. */
export type StoredOriginalReport = Readonly<{
  sourceId: string;
  revision: string;
  state: StoredOriginalState;
  recordedSha256: string;
  currentSha256: string | null;
  byteLength: number | null;
}>;

/**
 * Looks at the original of each source record (the files below `<raw>/<sourceId>/<revision>/`): `MATCH` when a file has the SHA-256 of
 * the record, `CHANGED` when there are files and none has it, `MISSING` when there is no file. The records are in the order of the source ID
 * and the revision. It only reads, so it can be run at any time; the build and `issues export` make the same comparison (`SOURCE_CHANGED`).
 */
export async function verifyStoredOriginals(store: IntakeStore, sources: readonly RealSource[]): Promise<Outcome<readonly StoredOriginalReport[], ReadFailure>> {
  const ordered = [...sources].sort((first, second) => {
    const left = `${first.sourceId}\u0000${first.revision}`;
    const right = `${second.sourceId}\u0000${second.revision}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const reports: StoredOriginalReport[] = [];
  for (const source of ordered) {
    const files = await readRawFiles(store, source.sourceId, source.revision);
    if (!files.ok) {
      return files;
    }
    const held = files.value ?? [];
    const first = held[0];
    const match = held.find((file) => file.sha256 === source.sha256);
    reports.push(
      match !== undefined
        ? { sourceId: source.sourceId, revision: source.revision, state: "MATCH", recordedSha256: source.sha256, currentSha256: match.sha256, byteLength: match.bytes.byteLength }
        : first !== undefined
          ? { sourceId: source.sourceId, revision: source.revision, state: "CHANGED", recordedSha256: source.sha256, currentSha256: first.sha256, byteLength: first.bytes.byteLength }
          : { sourceId: source.sourceId, revision: source.revision, state: "MISSING", recordedSha256: source.sha256, currentSha256: null, byteLength: null },
    );
  }
  return succeed(reports);
}
