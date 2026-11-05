import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  decodeProviderResult,
  type ScreenDataModel,
} from "./decodeProviderResult.js";

const TOKEN_CHARACTERS = [..."abcdefghijklmnopqrstuvwxyz0123456789"] as const;
const SAFE_FIELD_PATH = /^(?:\$|dataKind|requestId|route|status|message|items(?:\[\d+\])?(?:\.(?:dataKind|itemId|fields)(?:\[\d+\])?(?:\.(?:name|value))?)?|operations(?:\[\d+\])?(?:\.(?:operationId|label|route))?|error(?:\.(?:code|message|fields(?:\[\d+\])?|retry(?:\.(?:allowed|remaining))?))?)$/u;

const tokenArbitrary = fc
  .array(fc.constantFrom(...TOKEN_CHARACTERS), {
    minLength: 1,
    maxLength: 20,
  })
  .map((characters) => characters.join(""));

const routeArbitrary = tokenArbitrary.map((token) => `/screen/${token}`);
const scalarArbitrary = fc.oneof(
  tokenArbitrary,
  fc.integer({ min: -10_000, max: 10_000 }),
  fc.boolean(),
  fc.constant(null),
);

const namedValueArbitrary = fc.record({
  name: tokenArbitrary,
  value: scalarArbitrary,
});

const semanticItemArbitrary = fc.record({
  itemId: tokenArbitrary,
  fields: fc.array(namedValueArbitrary, { minLength: 1, maxLength: 4 }),
});

const operationArbitrary = fc.record({
  operationId: tokenArbitrary,
  label: tokenArbitrary,
  route: routeArbitrary,
});

const commonArbitraries = {
  requestId: tokenArbitrary,
  route: routeArbitrary,
  operations: fc.array(operationArbitrary, { minLength: 1, maxLength: 3 }),
} as const;

const semanticResponseArbitrary = fc.oneof(
  fc.record({
    ...commonArbitraries,
    status: fc.constant("success" as const),
    items: fc.array(semanticItemArbitrary, { minLength: 1, maxLength: 3 }),
  }),
  fc.record({
    ...commonArbitraries,
    status: fc.constant("no-data" as const),
    items: fc.constant([] as const),
    message: tokenArbitrary,
  }),
  fc.record({
    ...commonArbitraries,
    status: fc.constant("no-results" as const),
    items: fc.constant([] as const),
    message: tokenArbitrary,
  }),
  fc.record({
    ...commonArbitraries,
    status: fc.constant("failure" as const),
    items: fc.constant([] as const),
    error: fc.record({
      code: fc.constantFrom(
        "INTERNAL_FAILURE" as const,
        "ACCESS_DENIED" as const,
        "VIEW_TIMEOUT" as const,
      ),
      message: tokenArbitrary,
      fields: fc.array(tokenArbitrary, { maxLength: 3 }),
      retry: fc.record({
        allowed: fc.boolean(),
        remaining: fc.integer({ min: 0, max: 3 }),
      }),
    }),
  }),
);

const mutationArbitrary = fc.constantFrom(
  "missing-data-kind",
  "unknown-data-kind",
  "missing-request-id",
  "invalid-status",
  "missing-route",
  "extra-root-field",
  "mixed-item-kind",
  "invalid-operation",
  "extra-operation-field",
  "missing-state-payload",
);

type DataKind = "FIXTURE" | "REAL_AI";
type Mutation = typeof mutationArbitrary extends fc.Arbitrary<infer TValue>
  ? TValue
  : never;
type SemanticResponse = typeof semanticResponseArbitrary extends fc.Arbitrary<
  infer TValue
>
  ? TValue
  : never;

type RawItem = Readonly<{
  dataKind: DataKind;
  itemId: string;
  fields: readonly Readonly<{ name: string; value: boolean | null | number | string }>[];
}>;

type RawOperation = Readonly<{
  operationId: string;
  label: string;
  route: string;
}>;

type RawProviderResult = Readonly<{
  dataKind: DataKind;
  status: SemanticResponse["status"];
  requestId: string;
  route: string;
  operations: readonly RawOperation[];
  items: readonly RawItem[];
  message?: string;
  error?: Readonly<{
    code: "ACCESS_DENIED" | "INTERNAL_FAILURE" | "VIEW_TIMEOUT";
    message: string;
    fields: readonly string[];
    retry: Readonly<{ allowed: boolean; remaining: number }>;
  }>;
}>;

function providerResultFor(
  semantic: SemanticResponse,
  dataKind: DataKind,
): RawProviderResult {
  const items = semantic.items.map((item) => ({
    dataKind,
    itemId: item.itemId,
    fields: item.fields.map((field) => ({ ...field })),
  }));

  if (semantic.status === "failure") {
    return {
      dataKind,
      status: semantic.status,
      requestId: semantic.requestId,
      route: semantic.route,
      operations: semantic.operations,
      items,
      error: semantic.error,
    };
  }

  if (semantic.status === "no-data" || semantic.status === "no-results") {
    return {
      dataKind,
      status: semantic.status,
      requestId: semantic.requestId,
      route: semantic.route,
      operations: semantic.operations,
      items,
      message: semantic.message,
    };
  }

  return {
    dataKind,
    status: semantic.status,
    requestId: semantic.requestId,
    route: semantic.route,
    operations: semantic.operations,
    items,
  };
}

function mutateOneField(
  result: RawProviderResult,
  mutation: Mutation,
): unknown {
  const mutated: Record<string, unknown> = {
    ...result,
    operations: result.operations.map((operation) => ({ ...operation })),
    items: result.items.map((item) => ({
      ...item,
      fields: item.fields.map((field) => ({ ...field })),
    })),
  };

  switch (mutation) {
    case "missing-data-kind":
      delete mutated.dataKind;
      break;
    case "unknown-data-kind":
      mutated.dataKind = "UNDECLARED_KIND";
      break;
    case "missing-request-id":
      delete mutated.requestId;
      break;
    case "invalid-status":
      mutated.status = "partial";
      break;
    case "missing-route":
      delete mutated.route;
      break;
    case "extra-root-field":
      mutated.unexpected = true;
      break;
    case "mixed-item-kind": {
      const oppositeKind = result.dataKind === "REAL_AI" ? "FIXTURE" : "REAL_AI";
      const firstItem = result.items[0];
      mutated.items = [
        firstItem === undefined
          ? {
              dataKind: oppositeKind,
              itemId: "mixed-item",
              fields: [{ name: "mixed", value: "mixed" }],
            }
          : { ...firstItem, dataKind: oppositeKind },
        ...result.items.slice(1),
      ];
      break;
    }
    case "invalid-operation":
      mutated.operations = [
        { ...result.operations[0], operationId: "" },
        ...result.operations.slice(1),
      ];
      break;
    case "extra-operation-field":
      mutated.operations = [
        { ...result.operations[0], unexpected: true },
        ...result.operations.slice(1),
      ];
      break;
    case "missing-state-payload":
      if (result.status === "success") {
        delete mutated.items;
      } else if (result.status === "failure") {
        delete mutated.error;
      } else {
        delete mutated.message;
      }
      break;
  }

  return mutated;
}

function sharedModel(model: ScreenDataModel): Omit<ScreenDataModel, "dataLabel"> {
  return {
    requestId: model.requestId,
    route: model.route,
    state: model.state,
    items: model.items,
    operations: model.operations,
    message: model.message,
    failure: model.failure,
  };
}

describe("Property 40: data provider contract and UI shape isomorphism", () => {
  // Feature: ehime-vote-navigator, Property 40: data provider契約とUI構造の同型性
  // **Validates: Requirements 17.19, 17.20, 17.21, 17.22**
  it("keeps equivalent provider models isomorphic and fails closed for one-field violations", () => {
    fc.assert(
      fc.property(
        semanticResponseArbitrary,
        mutationArbitrary,
        fc.constantFrom("REAL_AI", "FIXTURE" as const),
        (semantic, mutation, invalidKind) => {
          const realInput = providerResultFor(semantic, "REAL_AI");
          const fixtureInput = providerResultFor(semantic, "FIXTURE");
          const real = decodeProviderResult(realInput);
          const fixture = decodeProviderResult(fixtureInput);

          expect(real.ok).toBe(true);
          expect(fixture.ok).toBe(true);
          if (!real.ok || !fixture.ok) {
            return;
          }

          expect(real.value.dataLabel).toBe("2022年実資料・AI解析");
          expect(fixture.value.dataLabel).toBe(
            "架空fixture・UIテスト専用",
          );
          expect(sharedModel(real.value)).toEqual(sharedModel(fixture.value));
          expect(real.value.route).toBe(semantic.route);
          expect(real.value.state).toBe(semantic.status);
          expect(real.value.operations.map(({ operationId }) => operationId)).toEqual(
            semantic.operations.map(({ operationId }) => operationId),
          );
          expect(
            real.value.items.map((item) =>
              item.fields.map(({ name }) => name),
            ),
          ).toEqual(
            semantic.items.map((item) =>
              item.fields.map(({ name }) => name),
            ),
          );

          const invalidInput = mutateOneField(
            invalidKind === "REAL_AI" ? realInput : fixtureInput,
            mutation,
          );
          const invalid = decodeProviderResult(invalidInput);

          expect(invalid.ok).toBe(false);
          if (invalid.ok) {
            return;
          }

          expect(invalid.error.state).toBe("no-data");
          expect(invalid.error.outputs.display).toHaveLength(0);
          expect(invalid.error.outputs.save).toHaveLength(0);
          expect(invalid.error.fieldPaths.length).toBeGreaterThan(0);
          expect(
            invalid.error.fieldPaths.every((path) => SAFE_FIELD_PATH.test(path)),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
