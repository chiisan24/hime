import { Sha256Schema, SourceConversionSchema } from "@ehime-vote-navigator/contracts";
import type { Sha256, SourceConversion } from "@ehime-vote-navigator/contracts";
import { sha256Hex } from "@ehime-vote-navigator/domain";

import { fail, succeed } from "../draft/types.js";
import type { Outcome } from "../draft/types.js";

/**
 * The record of a conversion by a person (Req 7.24, design 3b). A publisher offers, for example, an
 * xlsx file. No dependency for xlsx is added: a person converts the file to CSV, one row of the
 * original to one row of the CSV, and the intake records the conversion in the source record. The
 * record is built from the files themselves, not from numbers that a person types:
 *
 *   - the SHA-256 of the original, of the CSV and of the written procedure are computed from the bytes;
 *   - the number of rows of the CSV is counted by the intake (the header and the data rows, without a
 *     line that has nothing on it: `recordCount` of `inspectCsvTable`), and the number of rows of the
 *     original is what the person says, in the same way of counting (the header included). The two have
 *     to be the same, or nothing is taken in;
 *   - the person who converted and the time are the confirmation record (a conversion cannot be
 *     reproduced by a machine). Without them nothing is taken in.
 *
 * The original and the written procedure are not stored by the intake. The original stays where it was
 * obtained (`data/real/open-data/...`), and the person keeps the procedure; their SHA-256 are recorded,
 * so that a change of either is found by comparing.
 */

export type ConversionRequest = Readonly<{
  /** A plain file name of the original, for example `shelters.xlsx`. It is recorded, not opened. */
  originalFileName: string;
  /**
   * The bytes of the original, as the person has them. That it is the file that the person expects (its SHA-256 and its size) is
   * checked by the intake, with the `expectedOriginal` of the request, before anything else is read.
   */
  originalBytes: Uint8Array;
  /** The identifier of the written procedure (how to open the file, the format of saving, the encoding, the rows that were checked). */
  procedureId: string;
  procedureDocBytes: Uint8Array;
  /** The person who converted and checked the rows, and when. */
  convertedBy: string;
  convertedAt: string;
  /** One row of the original is one row of the CSV. A conversion that does not keep the rows is not recorded. */
  correspondence: "ROWS_PRESERVED";
  /** The rows of the original, the header included. */
  originalRowCount: number;
}>;

export const CONVERSION_REFUSAL_CODES = ["CONVERSION_INVALID", "ROW_COUNT_MISMATCH"] as const;

export type ConversionRefusalCode = (typeof CONVERSION_REFUSAL_CODES)[number];

/** The names of the items that are wrong, and the two numbers of a mismatch of rows. Never a value of a file. */
export type ConversionRefusal = Readonly<{
  code: ConversionRefusalCode;
  fields?: readonly string[];
  originalRowCount?: number;
  convertedRowCount?: number;
}>;

function isNonEmptyBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength > 0;
}

/**
 * The record of the conversion, or the reason that it cannot be made. `converted` is the CSV that is
 * taken in: its SHA-256 and the number of its rows, which the intake has computed from the file.
 */
export function buildConversion(request: ConversionRequest, converted: Readonly<{ sha256: Sha256; recordCount: number }>): Outcome<SourceConversion, ConversionRefusal> {
  const wrong: string[] = [];
  if (!isNonEmptyBytes(request.originalBytes)) {
    wrong.push("originalBytes");
  }
  if (!isNonEmptyBytes(request.procedureDocBytes)) {
    wrong.push("procedureDocBytes");
  }
  if (request.correspondence !== "ROWS_PRESERVED") {
    wrong.push("correspondence");
  }
  if (!Number.isSafeInteger(request.originalRowCount) || request.originalRowCount < 0) {
    wrong.push("originalRowCount");
  }
  if (wrong.length > 0) {
    return fail({ code: "CONVERSION_INVALID", fields: wrong });
  }

  const originalSha256 = Sha256Schema.parse(sha256Hex(request.originalBytes));
  if (request.originalRowCount !== converted.recordCount) {
    return fail({ code: "ROW_COUNT_MISMATCH", originalRowCount: request.originalRowCount, convertedRowCount: converted.recordCount });
  }

  const parsed = SourceConversionSchema.safeParse({
    originalFileName: request.originalFileName,
    originalSha256,
    convertedSha256: converted.sha256,
    procedureId: request.procedureId,
    procedureDocSha256: Sha256Schema.parse(sha256Hex(request.procedureDocBytes)),
    convertedBy: request.convertedBy,
    convertedAt: request.convertedAt,
    correspondence: request.correspondence,
    originalRowCount: request.originalRowCount,
    convertedRowCount: converted.recordCount,
  });
  if (!parsed.success) {
    return fail({ code: "CONVERSION_INVALID", fields: [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "conversion")))] });
  }
  return succeed(parsed.data);
}
