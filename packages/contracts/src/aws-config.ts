import { z } from "zod";

import { NonEmptyStringSchema } from "./models/primitives.js";

export const DEFAULT_AWS_PROFILE = "default";
export const DEFAULT_AWS_REGION = "ap-northeast-1";
export const MAX_AWS_PROFILE_LENGTH = 128;
export const MAX_BEDROCK_MODEL_ID_LENGTH = 256;

/** Name of the admin-issued Bedrock API key setting; its value is never modelled. */
export const BEDROCK_BEARER_TOKEN_ENV_NAME = "AWS_BEARER_TOKEN_BEDROCK";

export const BedrockModelEnvNameSchema = z.enum([
  "BEDROCK_GENERATION_MODEL_ID",
  "BEDROCK_VERIFICATION_MODEL_ID",
  "BEDROCK_EMBEDDING_MODEL_ID",
]);

export const AwsConfigEnvNameSchema = z.enum([
  "AWS_PROFILE",
  "AWS_REGION",
  "BEDROCK_CROSS_REGION",
  BEDROCK_BEARER_TOKEN_ENV_NAME,
  ...BedrockModelEnvNameSchema.options,
]);

/** Settings whose absence blocks every Bedrock call (embedding is optional). */
export const AwsRequiredEnvNameSchema = z.enum([
  BEDROCK_BEARER_TOKEN_ENV_NAME,
  "BEDROCK_GENERATION_MODEL_ID",
  "BEDROCK_VERIFICATION_MODEL_ID",
]);

/** Environment variable names for the three Bedrock purposes. */
export const BEDROCK_MODEL_ENV_NAMES = Object.freeze({
  generation: "BEDROCK_GENERATION_MODEL_ID",
  verification: "BEDROCK_VERIFICATION_MODEL_ID",
  embedding: "BEDROCK_EMBEDDING_MODEL_ID",
} as const satisfies Record<string, BedrockModelEnvName>);

export const BedrockModelIdViolationCodeSchema = z.enum([
  "MODEL_ID_INFERENCE_PROFILE",
  "MODEL_ID_INVALID_FORMAT",
]);

export const AwsConfigViolationCodeSchema = z.enum([
  "PROFILE_INVALID",
  "REGION_NOT_APPROVED",
  "CROSS_REGION_NOT_DISABLED",
  ...BedrockModelIdViolationCodeSchema.options,
]);

/** A violation names the offending setting only; it never carries the value. */
export const AwsConfigViolationSchema = z
  .object({
    code: AwsConfigViolationCodeSchema,
    name: AwsConfigEnvNameSchema,
  })
  .strict();

// System-defined inference profile IDs prefix a foundation model ID with a
// geography or the `global` scope (for example `apac.` or `global.`). The
// Japan-domestic `jp.` prefix is deliberately absent: the admin-issued key is
// limited to `jp.` IDs, which stay inside Japan, so they are accepted.
const INFERENCE_PROFILE_PREFIXES: ReadonlySet<string> = new Set([
  "us",
  "us-gov",
  "eu",
  "apac",
  "au",
  "ca",
  "in",
  "global",
]);

// Foundation model IDs are `provider.model[:version]`. A bare identifier (an
// application inference profile ID) or a path-like value (an ARN) does not match.
const FOUNDATION_MODEL_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

/**
 * Classifies a trimmed model ID that is neither a plain foundation model ID
 * nor a Japan-domestic `jp.` ID. Other inference profile forms are rejected
 * because they can route outside Japan; other malformed values are rejected as
 * an invalid format.
 */
export function findBedrockModelIdViolation(
  modelId: string,
): BedrockModelIdViolationCode | undefined {
  const normalized = modelId.toLowerCase();

  if (normalized.startsWith("arn:") && normalized.includes("inference-profile")) {
    return "MODEL_ID_INFERENCE_PROFILE";
  }

  const prefix = normalized.split(".", 1)[0] ?? "";
  if (normalized.includes(".") && INFERENCE_PROFILE_PREFIXES.has(prefix)) {
    return "MODEL_ID_INFERENCE_PROFILE";
  }

  if (
    modelId.length > MAX_BEDROCK_MODEL_ID_LENGTH ||
    !FOUNDATION_MODEL_ID_PATTERN.test(modelId)
  ) {
    return "MODEL_ID_INVALID_FORMAT";
  }

  return undefined;
}

export const BedrockModelIdSchema = z.string().superRefine((value, context) => {
  if (findBedrockModelIdViolation(value) !== undefined) {
    context.addIssue({
      code: "custom",
      message:
        "Expected a foundation model ID or a Japan-domestic jp. model ID.",
    });
  }
});

export const ReadyAwsConfigSchema = z
  .object({
    profile: NonEmptyStringSchema.max(MAX_AWS_PROFILE_LENGTH),
    region: z.literal(DEFAULT_AWS_REGION),
    crossRegion: z.literal(false),
    models: z
      .object({
        generation: BedrockModelIdSchema,
        verification: BedrockModelIdSchema,
        /** `null` when no embedding model is configured (capability unavailable). */
        embedding: BedrockModelIdSchema.nullable(),
      })
      .strict(),
  })
  .strict();

/** Names of absent required settings, plus rejected settings; never any value. */
export const AwsConfigNotReadySchema = z
  .object({
    missing: z.array(AwsRequiredEnvNameSchema).readonly(),
    violations: z.array(AwsConfigViolationSchema).readonly(),
  })
  .strict()
  .refine((value) => value.missing.length + value.violations.length > 0, {
    message: "A not-ready AWS configuration must name at least one problem.",
  });

export type BedrockModelEnvName = z.infer<typeof BedrockModelEnvNameSchema>;
export type AwsConfigEnvName = z.infer<typeof AwsConfigEnvNameSchema>;
export type AwsRequiredEnvName = z.infer<typeof AwsRequiredEnvNameSchema>;
export type BedrockModelIdViolationCode = z.infer<
  typeof BedrockModelIdViolationCodeSchema
>;
export type AwsConfigViolationCode = z.infer<
  typeof AwsConfigViolationCodeSchema
>;
export type AwsConfigViolation = z.infer<typeof AwsConfigViolationSchema>;
export type ReadyAwsConfig = z.infer<typeof ReadyAwsConfigSchema>;
export type AwsConfigNotReady = z.infer<typeof AwsConfigNotReadySchema>;
