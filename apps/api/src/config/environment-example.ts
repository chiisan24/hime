import { z } from "zod";

export const EnvironmentExampleSchema = z
  .object({
    AWS_PROFILE: z.literal("default"),
    AWS_REGION: z.literal("ap-northeast-1"),
    BEDROCK_GENERATION_MODEL_ID: z.literal(""),
    BEDROCK_VERIFICATION_MODEL_ID: z.literal(""),
    BEDROCK_EMBEDDING_MODEL_ID: z.literal(""),
    BEDROCK_CROSS_REGION: z.literal("false"),
  })
  .strict();

export type EnvironmentExample = z.infer<typeof EnvironmentExampleSchema>;

/** Parses only the checked-in, secret-free environment example format. */
export function parseEnvironmentExample(source: string): EnvironmentExample {
  const values = Object.create(null) as Record<string, string>;

  for (const [index, originalLine] of source.split(/\r?\n/u).entries()) {
    const line = originalLine.trim();

    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    const key = line.slice(0, separatorIndex);

    if (
      separatorIndex <= 0 ||
      !/^[A-Z][A-Z0-9_]*$/u.test(key) ||
      Object.hasOwn(values, key)
    ) {
      throw new Error(`Invalid environment example entry on line ${index + 1}.`);
    }

    values[key] = line.slice(separatorIndex + 1);
  }

  return EnvironmentExampleSchema.parse(values);
}
