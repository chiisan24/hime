import type { Result } from "@ehime-vote-navigator/domain";

/**
 * What every supplier (manual placement now, an automatic fetcher later) hands
 * to the ingest: the body, the official URL it came from and when it was
 * retrieved. Nothing about the kind of supplier is carried forward.
 */
export type SuppliedSource = Readonly<{
  bytes: Uint8Array;
  officialUrl: string;
  retrievedAt: string;
}>;

export const SUPPLY_ERROR_CODES = [
  "FILE_NAME_INVALID",
  "FILE_NOT_FOUND",
  "FILE_UNREADABLE",
  "SUPPLY_INCOMPLETE",
  "SYMLINK_NOT_ALLOWED",
  "UNSUPPORTED_FILE_TYPE",
] as const;

export type SupplyErrorCode = (typeof SUPPLY_ERROR_CODES)[number];

export type SupplyError = Readonly<{
  code: SupplyErrorCode;
  /** Names of missing or invalid items; never their values. */
  fields?: readonly string[];
  safeMessage: string;
}>;

export interface SourceSupplier {
  supply(reference: string): Promise<Result<SuppliedSource, SupplyError>>;
}

const SUPPLY_MESSAGES: Readonly<Record<SupplyErrorCode, string>> = Object.freeze({
  FILE_NAME_INVALID: "The file name must be a plain name without a path.",
  FILE_NOT_FOUND: "The file was not found in the raw document folder.",
  FILE_UNREADABLE: "The file could not be read.",
  SUPPLY_INCOMPLETE: "The official URL or retrieved-at time is missing or invalid.",
  SYMLINK_NOT_ALLOWED: "Symbolic links are not allowed in the raw document folder.",
  UNSUPPORTED_FILE_TYPE: "Only .pdf files can be ingested.",
});

export function supplyFailure(
  code: SupplyErrorCode,
  fields?: readonly string[],
): Result<never, SupplyError> {
  return {
    ok: false,
    error: Object.freeze({
      code,
      safeMessage: SUPPLY_MESSAGES[code],
      ...(fields === undefined ? {} : { fields: Object.freeze([...fields]) }),
    }),
  };
}