import { z } from "zod";

import {
  ISODateSchema,
  ISOInstantSchema,
  NonEmptyStringSchema,
} from "./primitives.js";

export const PRE_RELEASE_CHECK_KINDS = [
  "ELECTION_LAW",
  "COPYRIGHT",
  "PRIVACY",
  "CANDIDATE_PHOTO",
  "SOURCE_USAGE",
  "ELECTION_COMMISSION",
] as const;
export const PreReleaseCheckKindSchema = z.enum(PRE_RELEASE_CHECK_KINDS);

export const PreReleaseCheckSchema = z
  .object({
    kind: PreReleaseCheckKindSchema,
    completed: z.boolean(),
    reviewerId: NonEmptyStringSchema.nullable(),
    checkedAt: ISODateSchema.nullable(),
    checkedTarget: NonEmptyStringSchema.nullable(),
    evidence: NonEmptyStringSchema.nullable(),
  })
  .strict();

export const P0CheckItemSchema = z
  .object({
    checkId: NonEmptyStringSchema,
    outcome: z.enum(["PASS", "FAIL"]),
    safeMessage: NonEmptyStringSchema,
    evidenceUris: z.array(NonEmptyStringSchema).readonly(),
  })
  .strict();

export const P0_STATUSES = ["P0完成", "P0未完成"] as const;
export const P0StatusSchema = z.enum(P0_STATUSES);

export const DEADLINE_STATUSES = [
  "期限内完成",
  "期限超過",
  "完成日時なし",
] as const;
export const DeadlineStatusSchema = z.enum(DEADLINE_STATUSES);

export const P0CheckResultSchema = z
  .object({
    p0CheckId: NonEmptyStringSchema,
    checkedAtJst: ISOInstantSchema,
    status: P0StatusSchema,
    deadlineStatus: DeadlineStatusSchema,
    completionAtJst: ISOInstantSchema.nullable(),
    items: z.array(P0CheckItemSchema).readonly(),
  })
  .strict();

export type PreReleaseCheckKind = z.infer<typeof PreReleaseCheckKindSchema>;
export type PreReleaseCheck = z.infer<typeof PreReleaseCheckSchema>;
export type P0CheckItem = z.infer<typeof P0CheckItemSchema>;
export type P0Status = z.infer<typeof P0StatusSchema>;
export type DeadlineStatus = z.infer<typeof DeadlineStatusSchema>;
export type P0CheckResult = z.infer<typeof P0CheckResultSchema>;
