import { z } from "zod";

/**
 * Regional values map: contracts for the settings files in
 * `config/regional-values/`.
 *
 * Every object is strict, so extra and missing keys are rejected. This file
 * imports `zod` only.
 */

/** The largest allowed T2: a theme score never exceeds 200 in absolute value. */
const MAX_THRESHOLD = 200;

/**
 * The two score thresholds that turn a score into a level: `0 < t1 < t2 <= 200`,
 * both integers. A score with an absolute value below `t1` is level 0, and one
 * at or above `t2` is level 2.
 */
const ThresholdsSchema = z
  .object({
    t1: z.number().int().positive(),
    t2: z.number().int().positive().max(MAX_THRESHOLD),
  })
  .strict()
  .superRefine((thresholds, context) => {
    if (thresholds.t1 >= thresholds.t2) {
      context.addIssue({
        code: "custom",
        message: "t1 must be less than t2",
        path: ["t2"],
      });
    }
  });

/** `config/regional-values/map.json`. */
export const MapConfigSchema = z
  .object({
    thresholds: ThresholdsSchema,
    /** Upper limit on the themes in the guidance on how to use the result (Req 6.6); at least 1. */
    guidanceMaxThemes: z.number().int().min(1),
  })
  .strict();

export type MapConfig = z.infer<typeof MapConfigSchema>;
