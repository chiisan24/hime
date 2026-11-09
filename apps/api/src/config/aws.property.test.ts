import {
  AwsConfigNotReadySchema,
  BEDROCK_BEARER_TOKEN_ENV_NAME,
  BEDROCK_MODEL_ENV_NAMES,
  ReadyAwsConfigSchema,
  type AwsRequiredEnvName,
} from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { resolveAwsConfig, withReadyAwsConfig } from "./aws.js";

const RUNS = 200;
const MARKER = "zzmark";

const PURPOSES = ["generation", "verification", "embedding"] as const;
type Purpose = (typeof PURPOSES)[number];
// The embedding model is optional: only these two can block Bedrock calls by being absent.
const REQUIRED_PURPOSES = ["generation", "verification"] as const;

/** One generated setting: its raw value (undefined = key absent) and its class. */
type Slot = Readonly<{
  kind: "unset" | "good" | "rejected";
  raw: string | undefined;
  /** What a ready config must hold for a good slot. */
  accepted?: string;
}>;

const blankArb = fc.constantFrom<string | undefined>(undefined, "", "  ", "\t\n");
const paddingArb = fc.constantFrom("", " ", "\t");

function slotArb(
  good: fc.Arbitrary<string>,
  rejected: fc.Arbitrary<string>,
): fc.Arbitrary<Slot> {
  // Weighted toward accepted values so fully ready environments are common.
  return fc.oneof(
    {
      weight: 1,
      arbitrary: blankArb.map((raw): Slot => ({ kind: "unset", raw })),
    },
    {
      weight: 4,
      arbitrary: fc
        .tuple(paddingArb, good, paddingArb)
        .map(([left, value, right]): Slot => ({
          kind: "good",
          raw: `${left}${value}${right}`,
          accepted: value,
        })),
    },
    {
      weight: 1,
      arbitrary: rejected.map((raw): Slot => ({ kind: "rejected", raw })),
    },
  );
}

const providerArb = fc.constantFrom("amazon", "anthropic", "cohere", "meta", "mistral");
const modelNameArb = fc.stringMatching(/^[a-z][a-z0-9-]{2,24}(?::[0-9]{1,2})?$/);
const plainModelIdArb = fc
  .tuple(providerArb, modelNameArb)
  .map(([provider, name]) => `${provider}.${name}`);
// Japan-domestic IDs are accepted alongside plain foundation model IDs.
const japanModelIdArb = fc
  .tuple(providerArb, modelNameArb)
  .map(([provider, name]) => `jp.${provider}.${name}`);
const foundationModelIdArb = fc.oneof(plainModelIdArb, japanModelIdArb);

const geoPrefixArb = fc.constantFrom("us", "us-gov", "eu", "apac", "au", "ca", "in", "global");
const rejectedModelIdArb = fc.oneof(
  fc
    .tuple(geoPrefixArb, providerArb, modelNameArb)
    .map(([geo, provider, name]) => `${geo}.${provider}.${MARKER}-${name}`),
  fc
    .tuple(
      fc.constantFrom("inference-profile", "application-inference-profile"),
      fc.stringMatching(/^[a-z0-9]{6,12}$/),
    )
    .map(
      ([kind, id]) =>
        `arn:aws:bedrock:ap-northeast-1:123456789012:${kind}/${MARKER}${id}`,
    ),
  fc.stringMatching(/^[a-z0-9]{6,12}$/).map((id) => `${MARKER}${id}`),
  fc.constant(`${MARKER} with spaces.model`),
);

const profileArb = slotArb(
  fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,30}$/),
  fc.oneof(
    fc.constant(`${MARKER}\u0001profile`),
    fc.constant(`${MARKER}${"a".repeat(130)}`),
  ),
);
const regionArb = slotArb(
  fc.constant("ap-northeast-1"),
  fc.oneof(
    fc.constantFrom("us-east-1", "eu-west-1", "ap-northeast-3", "AP-NORTHEAST-1"),
    fc.stringMatching(/^[a-z0-9]{4,10}$/).map((value) => `${MARKER}-${value}`),
  ),
);
const crossRegionArb = slotArb(
  fc.constant("false"),
  fc.oneof(
    fc.constantFrom("true", "TRUE", "1", "yes", "False"),
    fc.stringMatching(/^[a-z0-9]{4,10}$/).map((value) => `${MARKER}-${value}`),
  ),
);
const modelArb = slotArb(foundationModelIdArb, rejectedModelIdArb);
// The API key is only ever present or absent; its value carries MARKER so any
// echo of it into a result is caught by the serialization check below.
const tokenArb = fc.oneof(
  { weight: 1, arbitrary: blankArb.map((raw): Slot => ({ kind: "unset", raw })) },
  {
    weight: 4,
    arbitrary: fc
      .stringMatching(/^[A-Za-z0-9]{8,24}$/)
      .map((value): Slot => ({ kind: "good", raw: `${MARKER}-key-${value}` })),
  },
);

const slotsArb = fc.record({
  token: tokenArb,
  profile: profileArb,
  region: regionArb,
  crossRegion: crossRegionArb,
  generation: modelArb,
  verification: modelArb,
  embedding: modelArb,
});

type Slots = Readonly<{
  token: Slot;
  profile: Slot;
  region: Slot;
  crossRegion: Slot;
  generation: Slot;
  verification: Slot;
  embedding: Slot;
}>;

function toEnvironment(slots: Slots): Record<string, string> {
  const environment: Record<string, string> = {
    // Credential-looking noise must never be read or returned.
    AWS_ACCESS_KEY_ID: `${MARKER}-access-key`,
    AWS_SECRET_ACCESS_KEY: `${MARKER}-secret-key`,
    AWS_SESSION_TOKEN: `${MARKER}-session-token`,
  };
  const entries: ReadonlyArray<readonly [string, Slot]> = [
    [BEDROCK_BEARER_TOKEN_ENV_NAME, slots.token],
    ["AWS_PROFILE", slots.profile],
    ["AWS_REGION", slots.region],
    ["BEDROCK_CROSS_REGION", slots.crossRegion],
    [BEDROCK_MODEL_ENV_NAMES.generation, slots.generation],
    [BEDROCK_MODEL_ENV_NAMES.verification, slots.verification],
    [BEDROCK_MODEL_ENV_NAMES.embedding, slots.embedding],
  ];

  for (const [name, slot] of entries) {
    if (slot.raw !== undefined) {
      environment[name] = slot.raw;
    }
  }

  return environment;
}

/** Three call-counting adapter stand-ins; each call goes through the gate. */
function createCountingAdapters() {
  const counts: Record<Purpose, number> = {
    generation: 0,
    verification: 0,
    embedding: 0,
  };
  const callAll = (environment: Record<string, string>) =>
    PURPOSES.map((purpose) =>
      withReadyAwsConfig(environment, (config) => {
        counts[purpose] += 1;
        return config.models[purpose];
      }),
    );

  return { counts, callAll, total: () => PURPOSES.reduce((sum, p) => sum + counts[p], 0) };
}

describe("Property 32: AWS defaults and model pre-check", () => {
  /** **Validates: Requirements 14.1, 14.2, 14.3** */
  it("applies the documented defaults whenever the optional settings are unset", () => {
    fc.assert(
      fc.property(
        fc.record({
          profile: blankArb,
          region: fc.constantFrom<string | undefined>(undefined, "", " ", "ap-northeast-1"),
          crossRegion: fc.constantFrom<string | undefined>(undefined, "", "false"),
          generation: foundationModelIdArb,
          verification: foundationModelIdArb,
          embedding: fc.option(foundationModelIdArb, { nil: undefined }),
        }),
        (generated) => {
          const environment: Record<string, string> = {
            AWS_BEARER_TOKEN_BEDROCK: `${MARKER}-key`,
            BEDROCK_GENERATION_MODEL_ID: generated.generation,
            BEDROCK_VERIFICATION_MODEL_ID: generated.verification,
          };
          for (const [name, value] of [
            ["AWS_PROFILE", generated.profile],
            ["AWS_REGION", generated.region],
            ["BEDROCK_CROSS_REGION", generated.crossRegion],
            [BEDROCK_MODEL_ENV_NAMES.embedding, generated.embedding],
          ] as const) {
            if (value !== undefined) {
              environment[name] = value;
            }
          }

          const result = resolveAwsConfig(environment);

          expect(result.ok && result.value).toMatchObject({
            profile: "default",
            region: "ap-northeast-1",
            crossRegion: false,
            models: { embedding: generated.embedding ?? null },
          });
        },
      ),
      { numRuns: RUNS },
    );
  });

  /** **Validates: Requirements 14.4, 14.5, 14.6** */
  it("allows Bedrock calls only when the API key, both required model IDs, any given embedding ID, and the fixed settings pass", () => {
    let readyCases = 0;
    let blockedCases = 0;

    fc.assert(
      fc.property(slotsArb, (slots) => {
        const environment = toEnvironment(slots);
        const adapters = createCountingAdapters();
        const expectedReady =
          slots.token.kind === "good" &&
          slots.profile.kind !== "rejected" &&
          slots.region.kind !== "rejected" &&
          slots.crossRegion.kind !== "rejected" &&
          REQUIRED_PURPOSES.every((purpose) => slots[purpose].kind === "good") &&
          slots.embedding.kind !== "rejected";
        const results = adapters.callAll(environment);
        const resolved = resolveAwsConfig(environment);

        if (expectedReady) {
          readyCases += 1;
        } else {
          blockedCases += 1;
        }

        expect(resolved.ok).toBe(expectedReady);
        expect(results.every((result) => result.ok)).toBe(expectedReady);
        expect(adapters.total()).toBe(expectedReady ? PURPOSES.length : 0);

        if (resolved.ok) {
          expect(ReadyAwsConfigSchema.safeParse(resolved.value).success).toBe(true);
          expect(resolved.value).toEqual({
            profile: slots.profile.accepted ?? "default",
            region: "ap-northeast-1",
            crossRegion: false,
            models: {
              generation: slots.generation.accepted,
              verification: slots.verification.accepted,
              embedding: slots.embedding.accepted ?? null,
            },
          });
        } else {
          expect(AwsConfigNotReadySchema.safeParse(resolved.error).success).toBe(true);
          expect(resolved.error.missing).toEqual([
            ...(slots.token.kind === "unset"
              ? [BEDROCK_BEARER_TOKEN_ENV_NAME satisfies AwsRequiredEnvName]
              : []),
            ...REQUIRED_PURPOSES.filter((purpose) => slots[purpose].kind === "unset").map(
              (purpose): AwsRequiredEnvName => BEDROCK_MODEL_ENV_NAMES[purpose],
            ),
          ]);
          expect(resolved.error.violations.map((violation) => violation.name)).toEqual(
            [
              slots.profile.kind === "rejected" ? "AWS_PROFILE" : undefined,
              slots.region.kind === "rejected" ? "AWS_REGION" : undefined,
              slots.crossRegion.kind === "rejected" ? "BEDROCK_CROSS_REGION" : undefined,
              ...PURPOSES.map((purpose) =>
                slots[purpose].kind === "rejected"
                  ? BEDROCK_MODEL_ENV_NAMES[purpose]
                  : undefined,
              ),
            ].filter((name) => name !== undefined),
          );
        }

        // Rejected values and credential-looking values are never echoed.
        const serialized = JSON.stringify(resolved);
        expect(serialized).not.toContain(MARKER);
        for (const slot of Object.values(slots)) {
          const echoed = slot.raw?.trim() ?? "";
          if (slot.kind === "rejected" && echoed.length >= 4) {
            expect(serialized).not.toContain(echoed);
          }
        }
      }),
      { numRuns: RUNS },
    );

    // Guard against a vacuous run: both outcomes must have been generated.
    expect(readyCases).toBeGreaterThan(0);
    expect(blockedCases).toBeGreaterThan(0);
  });

  /** **Validates: Requirements 14.5, 14.6** */
  it("makes zero adapter calls and names every absent required setting", () => {
    fc.assert(
      fc.property(
        slotsArb,
        fc.subarray<"token" | (typeof REQUIRED_PURPOSES)[number]>(
          ["token", ...REQUIRED_PURPOSES],
          { minLength: 1 },
        ),
        blankArb,
        (slots, absentSettings, blank) => {
          const absent: Slot = { kind: "unset", raw: blank };
          const forced: Slots = {
            ...slots,
            ...Object.fromEntries(absentSettings.map((setting) => [setting, absent])),
          };
          const adapters = createCountingAdapters();

          const results = adapters.callAll(toEnvironment(forced));

          expect(adapters.total()).toBe(0);
          expect(results.every((result) => !result.ok)).toBe(true);
          for (const result of results) {
            expect(!result.ok && result.error.missing).toEqual([
              ...(forced.token.kind === "unset" ? [BEDROCK_BEARER_TOKEN_ENV_NAME] : []),
              ...REQUIRED_PURPOSES.filter(
                (purpose) => forced[purpose].kind === "unset",
              ).map((purpose) => BEDROCK_MODEL_ENV_NAMES[purpose]),
            ]);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
