import { configureGlobal } from "fast-check";

export const MIN_PROPERTY_RUNS = 100;

export const FAST_CHECK_ENVIRONMENT = Object.freeze({
  numRuns: "FC_NUM_RUNS",
  path: "FC_PATH",
  seed: "FC_SEED",
});

export type FastCheckParameters = Readonly<{
  numRuns: number;
  path?: string;
  seed?: number;
  verbose: 2;
}>;

type FastCheckEnvironment = Readonly<Record<string, string | undefined>>;

function readInteger(
  environment: FastCheckEnvironment,
  name: string,
): number | undefined {
  const rawValue = environment[name];

  if (rawValue === undefined || rawValue.trim() === "") {
    return undefined;
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a safe integer`);
  }

  return value;
}

/** Builds deterministic defaults while preserving fast-check's failure reporter. */
export function createFastCheckParameters(
  environment: FastCheckEnvironment = process.env,
): FastCheckParameters {
  const requestedRuns = readInteger(environment, FAST_CHECK_ENVIRONMENT.numRuns);
  const seed = readInteger(environment, FAST_CHECK_ENVIRONMENT.seed);
  const pathValue = environment[FAST_CHECK_ENVIRONMENT.path]?.trim();

  if (requestedRuns !== undefined && requestedRuns < 1) {
    throw new RangeError(`${FAST_CHECK_ENVIRONMENT.numRuns} must be positive`);
  }

  return Object.freeze({
    numRuns: Math.max(MIN_PROPERTY_RUNS, requestedRuns ?? MIN_PROPERTY_RUNS),
    verbose: 2 as const,
    ...(seed === undefined ? {} : { seed }),
    ...(pathValue === undefined || pathValue === "" ? {} : { path: pathValue }),
  });
}

/**
 * Applies defaults to all fc.assert/fc.check calls. The built-in reporter remains
 * active, so failures include the seed, shrunk counterexample, and replay path.
 */
export function installFastCheckDefaults(
  environment: FastCheckEnvironment = process.env,
): FastCheckParameters {
  const parameters = createFastCheckParameters(environment);
  configureGlobal(parameters);
  return parameters;
}
