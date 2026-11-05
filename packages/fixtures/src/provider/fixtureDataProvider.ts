import {
  FixtureProviderRequestSchema,
  FixtureProviderResultSchema,
  type FixtureProviderRequest,
  type FixtureProviderResult,
} from "@ehime-vote-navigator/contracts";

export const FIXTURE_PROVIDER_ENVIRONMENTS = ["test", "development"] as const;

export type FixtureProviderEnvironment =
  (typeof FIXTURE_PROVIDER_ENVIRONMENTS)[number];

export type FixtureProviderScenario = Readonly<{
  request: FixtureProviderRequest;
  result: FixtureProviderResult;
}>;

export type FixtureDataProvider = Readonly<{
  dataKind: "FIXTURE";
  getScreenData(request: unknown): Promise<FixtureProviderResult>;
}>;

export type FixtureProviderErrorCode =
  | "FIXTURE_PROVIDER_CONFIGURATION_INVALID"
  | "FIXTURE_PROVIDER_ENVIRONMENT_REJECTED"
  | "FIXTURE_REQUEST_INVALID"
  | "FIXTURE_REQUEST_NOT_CONFIGURED";

export class FixtureProviderError extends Error {
  public readonly code: FixtureProviderErrorCode;

  public constructor(code: FixtureProviderErrorCode) {
    super(code);
    this.name = "FixtureProviderError";
    this.code = code;
  }
}

function isFixtureEnvironment(
  value: unknown,
): value is FixtureProviderEnvironment {
  return value === "test" || value === "development";
}

function hasSameParameters(
  left: FixtureProviderRequest,
  right: FixtureProviderRequest,
): boolean {
  return (
    left.parameters.length === right.parameters.length &&
    left.parameters.every((parameter, index) => {
      const compared = right.parameters[index];
      return (
        compared !== undefined &&
        parameter.name === compared.name &&
        Object.is(parameter.value, compared.value)
      );
    })
  );
}

function isSameRequest(
  left: FixtureProviderRequest,
  right: FixtureProviderRequest,
): boolean {
  return (
    left.requestId === right.requestId &&
    left.route === right.route &&
    left.operation === right.operation &&
    hasSameParameters(left, right)
  );
}

/**
 * Creates an in-memory FIXTURE-only provider. Its closed scenario table has no
 * REAL_AI provider reference and therefore cannot act as an error fallback.
 */
export function createFixtureDataProvider(options: Readonly<{
  environment: FixtureProviderEnvironment;
  scenarios: readonly FixtureProviderScenario[];
}>): FixtureDataProvider {
  if (!isFixtureEnvironment(options.environment)) {
    throw new FixtureProviderError("FIXTURE_PROVIDER_ENVIRONMENT_REJECTED");
  }

  const scenariosByRequestId = new Map<string, FixtureProviderScenario>();

  for (const scenario of options.scenarios) {
    const request = FixtureProviderRequestSchema.safeParse(scenario.request);
    const result = FixtureProviderResultSchema.safeParse(scenario.result);

    if (!request.success || !result.success) {
      throw new FixtureProviderError("FIXTURE_PROVIDER_CONFIGURATION_INVALID");
    }

    if (
      request.data.requestId !== result.data.requestId ||
      request.data.route !== result.data.route ||
      scenariosByRequestId.has(request.data.requestId)
    ) {
      throw new FixtureProviderError("FIXTURE_PROVIDER_CONFIGURATION_INVALID");
    }

    scenariosByRequestId.set(
      request.data.requestId,
      Object.freeze({
        request: request.data,
        result: result.data,
      }),
    );
  }

  return Object.freeze({
    dataKind: "FIXTURE" as const,
    async getScreenData(input: unknown): Promise<FixtureProviderResult> {
      const request = FixtureProviderRequestSchema.safeParse(input);
      if (!request.success) {
        throw new FixtureProviderError("FIXTURE_REQUEST_INVALID");
      }

      const scenario = scenariosByRequestId.get(request.data.requestId);
      if (
        scenario === undefined ||
        !isSameRequest(scenario.request, request.data)
      ) {
        throw new FixtureProviderError("FIXTURE_REQUEST_NOT_CONFIGURED");
      }

      return scenario.result;
    },
  });
}
