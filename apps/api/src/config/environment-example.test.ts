import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  EnvironmentExampleSchema,
  parseEnvironmentExample,
} from "./environment-example.js";

const workspaceRootUrl = new URL("../../../../", import.meta.url);
const environmentExampleUrl = new URL(".env.example", workspaceRootUrl);

const expectedEnvironment = {
  AWS_BEARER_TOKEN_BEDROCK: "",
  AWS_REGION: "ap-northeast-1",
  BEDROCK_GENERATION_MODEL_ID: "",
  BEDROCK_VERIFICATION_MODEL_ID: "",
  BEDROCK_EMBEDDING_MODEL_ID: "",
  BEDROCK_CROSS_REGION: "false",
} as const;

describe("secret-free environment example", () => {
  it("contains only the documented defaults and empty key and model identifiers", async () => {
    const source = await readFile(environmentExampleUrl, "utf8");

    expect(parseEnvironmentExample(source)).toEqual(expectedEnvironment);
    expect(source).not.toMatch(
      /^(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|BEARER_TOKEN)=/mu,
    );
    expect(source).not.toMatch(/^AWS_BEARER_TOKEN_BEDROCK=\S/mu);
    expect(source).toMatch(/^AWS_BEARER_TOKEN_BEDROCK=$/mu);
  });

  it("names the two allowed model IDs in a comment", async () => {
    const source = await readFile(environmentExampleUrl, "utf8");

    expect(source).toMatch(
      /^#.*jp\.anthropic\.claude-haiku-5-5.*jp\.anthropic\.claude-opus-5-5/mu,
    );
  });

  it("rejects extra settings, a filled key, and enabled cross-Region inference", () => {
    expect(
      EnvironmentExampleSchema.safeParse({
        ...expectedEnvironment,
        AWS_ACCESS_KEY_ID: "",
      }).success,
    ).toBe(false);

    expect(
      EnvironmentExampleSchema.safeParse({
        ...expectedEnvironment,
        AWS_PROFILE: "default",
      }).success,
    ).toBe(false);

    expect(
      EnvironmentExampleSchema.safeParse({
        ...expectedEnvironment,
        AWS_BEARER_TOKEN_BEDROCK: "test-token",
      }).success,
    ).toBe(false);

    expect(
      EnvironmentExampleSchema.safeParse({
        ...expectedEnvironment,
        BEDROCK_CROSS_REGION: "true",
      }).success,
    ).toBe(false);
  });

  it("rejects malformed and duplicate entries without returning their values", () => {
    expect(() => parseEnvironmentExample("MALFORMED_ENTRY")).toThrow(
      "Invalid environment example entry on line 1.",
    );
    expect(() =>
      parseEnvironmentExample("AWS_REGION=ap-northeast-1\nAWS_REGION=ap-northeast-1\n"),
    ).toThrow("Invalid environment example entry on line 2.");
  });
});
