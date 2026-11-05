import {
  FixtureProviderRequestSchema,
  FixtureProviderResultSchema,
} from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import {
  FixtureProviderError,
  createFixtureDataProvider,
  type FixtureProviderScenario,
} from "./fixtureDataProvider.js";

function createScenario(
  requestId = "fixture-provider-request",
): FixtureProviderScenario {
  const request = FixtureProviderRequestSchema.parse({
    dataKind: "FIXTURE",
    requestId,
    route: "/fictional-provider-screen",
    operation: "load",
    parameters: [{ name: "scenario", value: "fictional" }],
  });
  const result = FixtureProviderResultSchema.parse({
    dataKind: "FIXTURE",
    status: "success",
    requestId,
    route: request.route,
    operations: [
      {
        operationId: "reload",
        label: "再読込",
        route: request.route,
      },
    ],
    items: [
      {
        dataKind: "FIXTURE",
        itemId: "fictional-provider-item",
        fields: [{ name: "title", value: "架空のテスト表示" }],
      },
    ],
  });

  return { request, result };
}

describe("fixture data provider", () => {
  it.each(["test", "development"] as const)(
    "serves only explicitly configured FIXTURE scenarios in %s",
    async (environment) => {
      const scenario = createScenario();
      const provider = createFixtureDataProvider({
        environment,
        scenarios: [scenario],
      });

      await expect(provider.getScreenData(scenario.request)).resolves.toEqual(
        scenario.result,
      );
      expect(provider.dataKind).toBe("FIXTURE");
    },
  );

  it("rejects production composition", () => {
    expect(() =>
      createFixtureDataProvider({
        environment: "production" as "test",
        scenarios: [],
      }),
    ).toThrow(
      new FixtureProviderError("FIXTURE_PROVIDER_ENVIRONMENT_REJECTED"),
    );
  });

  it("rejects REAL_AI requests and results at the fixture boundary", async () => {
    const scenario = createScenario();
    const provider = createFixtureDataProvider({
      environment: "test",
      scenarios: [scenario],
    });

    await expect(
      provider.getScreenData({
        ...scenario.request,
        dataKind: "REAL_AI",
      }),
    ).rejects.toMatchObject({ code: "FIXTURE_REQUEST_INVALID" });

    expect(() =>
      createFixtureDataProvider({
        environment: "test",
        scenarios: [
          {
            request: scenario.request,
            result: {
              ...scenario.result,
              dataKind: "REAL_AI",
            },
          } as unknown as FixtureProviderScenario,
        ],
      }),
    ).toThrow(
      new FixtureProviderError("FIXTURE_PROVIDER_CONFIGURATION_INVALID"),
    );
  });

  it("fails closed for an unconfigured request instead of falling back", async () => {
    const configured = createScenario();
    const unconfigured = createScenario("fixture-provider-unconfigured");
    const provider = createFixtureDataProvider({
      environment: "test",
      scenarios: [configured],
    });

    await expect(
      provider.getScreenData(unconfigured.request),
    ).rejects.toMatchObject({ code: "FIXTURE_REQUEST_NOT_CONFIGURED" });
  });

  it("rejects response/request mismatches and duplicate request IDs", () => {
    const first = createScenario();
    const second = createScenario();
    const mismatched = {
      request: first.request,
      result: FixtureProviderResultSchema.parse({
        ...first.result,
        requestId: "different-request",
      }),
    };

    expect(() =>
      createFixtureDataProvider({
        environment: "test",
        scenarios: [mismatched],
      }),
    ).toThrow(
      new FixtureProviderError("FIXTURE_PROVIDER_CONFIGURATION_INVALID"),
    );
    expect(() =>
      createFixtureDataProvider({
        environment: "development",
        scenarios: [first, second],
      }),
    ).toThrow(
      new FixtureProviderError("FIXTURE_PROVIDER_CONFIGURATION_INVALID"),
    );
  });
});
