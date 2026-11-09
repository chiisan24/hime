import {
  BEDROCK_BEARER_TOKEN_ENV_NAME,
  BEDROCK_MODEL_ENV_NAMES,
  DEFAULT_AWS_PROFILE,
  DEFAULT_AWS_REGION,
  MAX_AWS_PROFILE_LENGTH,
  findBedrockModelIdViolation,
  type AwsConfigEnvName,
  type AwsConfigNotReady,
  type AwsConfigViolation,
  type AwsRequiredEnvName,
  type BedrockModelEnvName,
  type ReadyAwsConfig,
} from "@ehime-vote-navigator/contracts";
import type { Result } from "@ehime-vote-navigator/domain";

export type AwsEnvironment = Readonly<Record<string, string | undefined>>;

/** Reads one named setting; blank and non-string values count as unset. */
function readSetting(
  environment: AwsEnvironment,
  name: AwsConfigEnvName,
): string | undefined {
  const value = environment[name];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed === "" ? undefined : trimmed;
}

type ModelSetting =
  | Readonly<{ status: "unset" }>
  | Readonly<{ status: "rejected" }>
  | Readonly<{ status: "accepted"; modelId: string }>;

/** Classifies one model setting; a rejection is recorded by name and code only. */
function readModelSetting(
  environment: AwsEnvironment,
  name: BedrockModelEnvName,
  violations: AwsConfigViolation[],
): ModelSetting {
  const modelId = readSetting(environment, name);

  if (modelId === undefined) {
    return { status: "unset" };
  }

  const violation = findBedrockModelIdViolation(modelId);
  if (violation !== undefined) {
    violations.push({ code: violation, name });
    return { status: "rejected" };
  }

  return { status: "accepted", modelId };
}

/**
 * Resolves the AWS and Bedrock settings from the API process environment.
 *
 * Only the documented settings are read. AWS access keys, secret keys, and
 * session tokens are never read. The Bedrock API key setting is checked for
 * presence only: its value is not stored, returned, or reported. The result
 * carries setting names and fixed codes, never rejected values. Anything other
 * than the Tokyo Region, disabled cross-Region inference, a present API key,
 * and plain or Japan-domestic (`jp.`) generation and verification model IDs is
 * not ready. The embedding model ID is optional: absent means the embedding
 * capability is unavailable (`null`), while a present but rejected ID is not
 * ready (Region approval is a later task).
 */
export function resolveAwsConfig(
  environment: AwsEnvironment = process.env,
): Result<ReadyAwsConfig, AwsConfigNotReady> {
  const missing: AwsRequiredEnvName[] = [];
  const violations: AwsConfigViolation[] = [];

  const profile = readSetting(environment, "AWS_PROFILE") ?? DEFAULT_AWS_PROFILE;
  if (profile.length > MAX_AWS_PROFILE_LENGTH || /\p{Cc}/u.test(profile)) {
    violations.push({ code: "PROFILE_INVALID", name: "AWS_PROFILE" });
  }

  const region = readSetting(environment, "AWS_REGION") ?? DEFAULT_AWS_REGION;
  if (region !== DEFAULT_AWS_REGION) {
    violations.push({ code: "REGION_NOT_APPROVED", name: "AWS_REGION" });
  }

  const crossRegion = readSetting(environment, "BEDROCK_CROSS_REGION") ?? "false";
  if (crossRegion !== "false") {
    violations.push({
      code: "CROSS_REGION_NOT_DISABLED",
      name: "BEDROCK_CROSS_REGION",
    });
  }

  if (readSetting(environment, BEDROCK_BEARER_TOKEN_ENV_NAME) === undefined) {
    missing.push(BEDROCK_BEARER_TOKEN_ENV_NAME);
  }

  const generation = readModelSetting(
    environment,
    BEDROCK_MODEL_ENV_NAMES.generation,
    violations,
  );
  if (generation.status === "unset") {
    missing.push(BEDROCK_MODEL_ENV_NAMES.generation);
  }

  const verification = readModelSetting(
    environment,
    BEDROCK_MODEL_ENV_NAMES.verification,
    violations,
  );
  if (verification.status === "unset") {
    missing.push(BEDROCK_MODEL_ENV_NAMES.verification);
  }

  const embedding = readModelSetting(
    environment,
    BEDROCK_MODEL_ENV_NAMES.embedding,
    violations,
  );

  if (
    missing.length > 0 ||
    violations.length > 0 ||
    generation.status !== "accepted" ||
    verification.status !== "accepted"
  ) {
    return {
      ok: false,
      error: Object.freeze({
        missing: Object.freeze(missing),
        violations: Object.freeze(violations),
      }),
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      profile,
      region: DEFAULT_AWS_REGION,
      crossRegion: false,
      models: Object.freeze({
        generation: generation.modelId,
        verification: verification.modelId,
        embedding: embedding.status === "accepted" ? embedding.modelId : null,
      }),
    }),
  };
}

/**
 * The only entry for code that talks to Bedrock: `use` runs after the settings
 * are checked and never runs when any setting is missing or rejected.
 */
export function withReadyAwsConfig<T>(
  environment: AwsEnvironment,
  use: (config: ReadyAwsConfig) => T,
): Result<T, AwsConfigNotReady> {
  const resolved = resolveAwsConfig(environment);

  if (!resolved.ok) {
    return resolved;
  }

  return { ok: true, value: use(resolved.value) };
}
