import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  AwsConfigNotReadySchema,
  ReadyAwsConfigSchema,
} from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { parseEnvironmentExample } from "./environment-example.js";
import {
  resolveAwsConfig,
  withReadyAwsConfig,
  type AwsEnvironment,
} from "./aws.js";

const GENERATION = "anthropic.example-generation-v1:0";
const VERIFICATION = "amazon.example-verification-v1:0";
const EMBEDDING = "cohere.example-embedding-v3";
const TOKEN = "test-token";

// Includes the dummy API key because a ready configuration requires its presence.
const MODEL_SETTINGS = Object.freeze({
  AWS_BEARER_TOKEN_BEDROCK: TOKEN,
  BEDROCK_GENERATION_MODEL_ID: GENERATION,
  BEDROCK_VERIFICATION_MODEL_ID: VERIFICATION,
  BEDROCK_EMBEDDING_MODEL_ID: EMBEDDING,
});

const webRootUrl = new URL("../../../web/", import.meta.url);
const workspaceRootUrl = new URL("../../../../", import.meta.url);

describe("AWS defaults", () => {
  it("applies the profile, Region, and cross-Region defaults", () => {
    const result = resolveAwsConfig({ ...MODEL_SETTINGS });

    expect(result).toEqual({
      ok: true,
      value: {
        profile: "default",
        region: "ap-northeast-1",
        crossRegion: false,
        models: {
          generation: GENERATION,
          verification: VERIFICATION,
          embedding: EMBEDDING,
        },
      },
    });
    expect(ReadyAwsConfigSchema.safeParse(result.ok && result.value).success).toBe(
      true,
    );
  });

  it("treats blank settings as unset and trims accepted values", () => {
    const result = resolveAwsConfig({
      AWS_BEARER_TOKEN_BEDROCK: ` ${TOKEN} `,
      AWS_PROFILE: "  ",
      AWS_REGION: "",
      BEDROCK_CROSS_REGION: " \t",
      BEDROCK_GENERATION_MODEL_ID: ` ${GENERATION} `,
      BEDROCK_VERIFICATION_MODEL_ID: VERIFICATION,
      BEDROCK_EMBEDDING_MODEL_ID: EMBEDDING,
    });

    expect(result.ok && result.value).toMatchObject({
      profile: "default",
      region: "ap-northeast-1",
      crossRegion: false,
      models: { generation: GENERATION },
    });
  });

  it("uses an explicit profile and accepts explicit safe values", () => {
    const result = resolveAwsConfig({
      ...MODEL_SETTINGS,
      AWS_PROFILE: "demo-sso",
      AWS_REGION: "ap-northeast-1",
      BEDROCK_CROSS_REGION: "false",
    });

    expect(result.ok && result.value.profile).toBe("demo-sso");
  });

  it("reports every missing required setting by name, in a fixed order", () => {
    const result = resolveAwsConfig({});

    expect(result).toEqual({
      ok: false,
      error: {
        missing: [
          "AWS_BEARER_TOKEN_BEDROCK",
          "BEDROCK_GENERATION_MODEL_ID",
          "BEDROCK_VERIFICATION_MODEL_ID",
        ],
        violations: [],
      },
    });
    expect(
      AwsConfigNotReadySchema.safeParse(!result.ok && result.error).success,
    ).toBe(true);
  });

  it.each([undefined, "", "   ", "\t\n"])(
    "names only the API key setting when the key is absent or blank (%j)",
    (blank) => {
      const environment: Record<string, string> = { ...MODEL_SETTINGS };
      if (blank === undefined) {
        delete environment["AWS_BEARER_TOKEN_BEDROCK"];
      } else {
        environment["AWS_BEARER_TOKEN_BEDROCK"] = blank;
      }

      const result = resolveAwsConfig(environment);

      expect(!result.ok && result.error).toEqual({
        missing: ["AWS_BEARER_TOKEN_BEDROCK"],
        violations: [],
      });
    },
  );

  it("treats the embedding model as optional and reports it as unavailable", () => {
    for (const embedding of [undefined, "", "  "]) {
      const environment: Record<string, string> = { ...MODEL_SETTINGS };
      if (embedding === undefined) {
        delete environment["BEDROCK_EMBEDDING_MODEL_ID"];
      } else {
        environment["BEDROCK_EMBEDDING_MODEL_ID"] = embedding;
      }

      const result = resolveAwsConfig(environment);

      expect(result.ok && result.value.models).toEqual({
        generation: GENERATION,
        verification: VERIFICATION,
        embedding: null,
      });
      expect(ReadyAwsConfigSchema.safeParse(result.ok && result.value).success).toBe(
        true,
      );
    }
  });

  it("still rejects a present but invalid embedding model ID", () => {
    const result = resolveAwsConfig({
      ...MODEL_SETTINGS,
      BEDROCK_EMBEDDING_MODEL_ID: "global.cohere.example-embedding-v3",
    });

    expect(!result.ok && result.error).toEqual({
      missing: [],
      violations: [
        { code: "MODEL_ID_INFERENCE_PROFILE", name: "BEDROCK_EMBEDDING_MODEL_ID" },
      ],
    });
  });

  it("accepts the two Japan-domestic jp. model IDs for generation and verification", () => {
    const result = resolveAwsConfig({
      ...MODEL_SETTINGS,
      BEDROCK_GENERATION_MODEL_ID: "jp.anthropic.claude-haiku-5-5",
      BEDROCK_VERIFICATION_MODEL_ID: "jp.anthropic.claude-opus-5-5",
    });

    expect(result.ok && result.value.models).toEqual({
      generation: "jp.anthropic.claude-haiku-5-5",
      verification: "jp.anthropic.claude-opus-5-5",
      embedding: EMBEDDING,
    });
  });

  it("reports only the missing purpose when one model setting is blank", () => {
    const result = resolveAwsConfig({
      ...MODEL_SETTINGS,
      BEDROCK_VERIFICATION_MODEL_ID: "   ",
    });

    expect(!result.ok && result.error).toEqual({
      missing: ["BEDROCK_VERIFICATION_MODEL_ID"],
      violations: [],
    });
  });

  it("matches the not-ready state of the checked-in example file", async () => {
    const source = await readFile(new URL(".env.example", workspaceRootUrl), "utf8");
    const result = resolveAwsConfig(parseEnvironmentExample(source));

    expect(!result.ok && result.error.missing).toEqual([
      "AWS_BEARER_TOKEN_BEDROCK",
      "BEDROCK_GENERATION_MODEL_ID",
      "BEDROCK_VERIFICATION_MODEL_ID",
    ]);
    expect(!result.ok && result.error.violations).toEqual([]);
  });
});

describe("fail-closed rejection", () => {
  it.each(["true", "TRUE", "1", "yes", "False", "enabled"])(
    "rejects enabled or unrecognized cross-Region inference (%s)",
    (value) => {
      const result = resolveAwsConfig({
        ...MODEL_SETTINGS,
        BEDROCK_CROSS_REGION: value,
      });

      expect(!result.ok && result.error).toEqual({
        missing: [],
        violations: [
          { code: "CROSS_REGION_NOT_DISABLED", name: "BEDROCK_CROSS_REGION" },
        ],
      });
    },
  );

  it.each(["us-east-1", "ap-northeast-3", "AP-NORTHEAST-1"])(
    "does not accept the non-Tokyo Region %s as ready",
    (region) => {
      const result = resolveAwsConfig({ ...MODEL_SETTINGS, AWS_REGION: region });

      expect(!result.ok && result.error.violations).toEqual([
        { code: "REGION_NOT_APPROVED", name: "AWS_REGION" },
      ]);
    },
  );

  it.each([
    "apac.anthropic.example-v1:0",
    "us.anthropic.example-v1:0",
    "eu.anthropic.example-v1:0",
    "us-gov.anthropic.example-v1:0",
    "global.anthropic.example-v1:0",
    "au.anthropic.example-v1:0",
    "ca.anthropic.example-v1:0",
    "in.anthropic.example-v1:0",
    "global.anthropic.claude-haiku-5-5",
    "us.anthropic.claude-haiku-5-5",
    "APAC.anthropic.example-v1:0",
    "arn:aws:bedrock:ap-northeast-1:123456789012:inference-profile/apac.x.y-v1:0",
    "arn:aws:bedrock:ap-northeast-1:123456789012:application-inference-profile/abc123",
  ])("rejects the inference profile form %s without echoing it", (modelId) => {
    const result = resolveAwsConfig({
      ...MODEL_SETTINGS,
      BEDROCK_EMBEDDING_MODEL_ID: modelId,
    });

    expect(!result.ok && result.error).toEqual({
      missing: [],
      violations: [
        { code: "MODEL_ID_INFERENCE_PROFILE", name: "BEDROCK_EMBEDDING_MODEL_ID" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(modelId);
  });

  it.each(["abcdef123456", "no spaces.allowed", "amazon.", ".nova", "a/b.c"])(
    "rejects the malformed model ID %s",
    (modelId) => {
      const result = resolveAwsConfig({
        ...MODEL_SETTINGS,
        BEDROCK_GENERATION_MODEL_ID: modelId,
      });

      expect(!result.ok && result.error.violations).toEqual([
        { code: "MODEL_ID_INVALID_FORMAT", name: "BEDROCK_GENERATION_MODEL_ID" },
      ]);
    },
  );

  it("rejects a profile name with control characters or excess length", () => {
    for (const profile of ["bad\u0000name", "bad\u0007name", "a".repeat(129)]) {
      const result = resolveAwsConfig({ ...MODEL_SETTINGS, AWS_PROFILE: profile });

      expect(!result.ok && result.error.violations).toEqual([
        { code: "PROFILE_INVALID", name: "AWS_PROFILE" },
      ]);
    }
  });

  it("reports missing and rejected settings together", () => {
    const result = resolveAwsConfig({
      BEDROCK_CROSS_REGION: "true",
      BEDROCK_GENERATION_MODEL_ID: "apac.anthropic.example-v1:0",
      BEDROCK_EMBEDDING_MODEL_ID: EMBEDDING,
    });

    expect(!result.ok && result.error).toEqual({
      missing: ["AWS_BEARER_TOKEN_BEDROCK", "BEDROCK_VERIFICATION_MODEL_ID"],
      violations: [
        { code: "CROSS_REGION_NOT_DISABLED", name: "BEDROCK_CROSS_REGION" },
        { code: "MODEL_ID_INFERENCE_PROFILE", name: "BEDROCK_GENERATION_MODEL_ID" },
      ],
    });
  });
});

describe("credential isolation", () => {
  it("reads only the seven documented settings and never returns credentials or the API key", () => {
    const secretValues = {
      AWS_ACCESS_KEY_ID: "fake-access-key-id-value",
      AWS_SECRET_ACCESS_KEY: "fake-secret-access-key-value",
      AWS_SESSION_TOKEN: "fake-session-token-value",
      AWS_BEARER_TOKEN_BEDROCK: "dummy-bearer-token-value",
    };
    const source: Record<string, string> = { ...MODEL_SETTINGS, ...secretValues };
    const touched = new Set<string>();
    const environment = new Proxy(source, {
      get(target, property) {
        touched.add(String(property));
        return Reflect.get(target, property);
      },
    }) as AwsEnvironment;

    const result = resolveAwsConfig(environment);

    expect(result.ok).toBe(true);
    expect([...touched].sort()).toEqual([
      "AWS_BEARER_TOKEN_BEDROCK",
      "AWS_PROFILE",
      "AWS_REGION",
      "BEDROCK_CROSS_REGION",
      "BEDROCK_EMBEDDING_MODEL_ID",
      "BEDROCK_GENERATION_MODEL_ID",
      "BEDROCK_VERIFICATION_MODEL_ID",
    ]);
    for (const secret of Object.values(secretValues)) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });

  it("runs the callback once when ready and never when not ready", () => {
    let calls = 0;
    const use = (): number => ++calls;

    const ready = withReadyAwsConfig({ ...MODEL_SETTINGS }, use);
    const blocked = withReadyAwsConfig({ ...MODEL_SETTINGS, AWS_BEARER_TOKEN_BEDROCK: "" }, use);
    const optionalEmbedding = withReadyAwsConfig(
      { ...MODEL_SETTINGS, BEDROCK_EMBEDDING_MODEL_ID: "" },
      use,
    );

    expect(ready).toEqual({ ok: true, value: 1 });
    expect(blocked.ok).toBe(false);
    expect(optionalEmbedding).toEqual({ ok: true, value: 2 });
    expect(calls).toBe(2);
  });
});

describe("web build isolation", () => {
  it("keeps AWS settings, credentials, and the config module out of web sources", async () => {
    const forbidden = [
      /@aws-sdk/u,
      /config\/aws/u,
      /aws-config/u,
      /AWS_(?:PROFILE|REGION|ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)/u,
      /AWS_BEARER_TOKEN/u,
      /bedrock-runtime/u,
      /aws\/bedrockConverse/u,
      /BEDROCK_/u,
      /process\.env/u,
    ];
    const sourceRoot = fileURLToPath(new URL("src/", webRootUrl));
    const relativePaths = (await readdir(sourceRoot, { recursive: true })).filter(
      (path) => /\.(?:ts|tsx|mts)$/u.test(path) && !/\.test\.tsx?$/u.test(path),
    );
    const files = [
      ...relativePaths.map((path) => `${sourceRoot}${path}`),
      fileURLToPath(new URL("vite.config.ts", webRootUrl)),
    ];
    const offenders: string[] = [];

    for (const file of files) {
      const text = await readFile(file, "utf8");
      if (forbidden.some((pattern) => pattern.test(text))) {
        offenders.push(file);
      }
    }

    expect(files.length).toBeGreaterThan(1);
    expect(offenders).toEqual([]);
  });
});
