import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  EnvironmentExampleSchema,
  parseEnvironmentExample,
} from "./environment-example.js";

const workspaceRootUrl = new URL("../../../../", import.meta.url);
const environmentExampleUrl = new URL(".env.example", workspaceRootUrl);

const expectedEnvironment = {
  AWS_PROFILE: "default",
  AWS_REGION: "ap-northeast-1",
  BEDROCK_GENERATION_MODEL_ID: "",
  BEDROCK_VERIFICATION_MODEL_ID: "",
  BEDROCK_EMBEDDING_MODEL_ID: "",
  BEDROCK_CROSS_REGION: "false",
} as const;

describe("secret-free environment example", () => {
  it("contains only the documented defaults and empty model identifiers", async () => {
    const source = await readFile(environmentExampleUrl, "utf8");

    expect(parseEnvironmentExample(source)).toEqual(expectedEnvironment);
    expect(source).not.toMatch(
      /^(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|BEARER_TOKEN)=/mu,
    );
  });

  it("rejects extra settings and enabled cross-Region inference", () => {
    expect(
      EnvironmentExampleSchema.safeParse({
        ...expectedEnvironment,
        AWS_ACCESS_KEY_ID: "",
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
      parseEnvironmentExample("AWS_PROFILE=default\nAWS_PROFILE=default\n"),
    ).toThrow("Invalid environment example entry on line 2.");
  });
});
