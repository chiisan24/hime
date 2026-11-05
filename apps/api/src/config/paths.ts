import { isAbsolute, relative, resolve, sep } from "node:path";

import { z } from "zod";

export const REAL_DATA_RELATIVE_ROOT = "data/real";
export const FIXTURE_RELATIVE_ROOT = "packages/fixtures";

const AbsolutePathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes("\0") && isAbsolute(value), {
    message: "Expected an absolute filesystem path.",
  });

function isStrictDescendant(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(candidatePath));

  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

function isSameOrDescendant(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(candidatePath));

  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

export const StoragePathConfigSchema = z
  .object({
    workspaceRoot: AbsolutePathSchema,
    realDataRoot: AbsolutePathSchema,
    fixtureRoot: AbsolutePathSchema,
  })
  .strict()
  .superRefine((config, context) => {
    if (!isStrictDescendant(config.workspaceRoot, config.realDataRoot)) {
      context.addIssue({
        code: "custom",
        message: "realDataRoot must be strictly inside workspaceRoot.",
        path: ["realDataRoot"],
      });
    }

    if (!isStrictDescendant(config.workspaceRoot, config.fixtureRoot)) {
      context.addIssue({
        code: "custom",
        message: "fixtureRoot must be strictly inside workspaceRoot.",
        path: ["fixtureRoot"],
      });
    }

    if (
      isSameOrDescendant(config.realDataRoot, config.fixtureRoot) ||
      isSameOrDescendant(config.fixtureRoot, config.realDataRoot)
    ) {
      context.addIssue({
        code: "custom",
        message: "realDataRoot and fixtureRoot must not overlap.",
        path: ["fixtureRoot"],
      });
    }
  })
  .transform((config) =>
    Object.freeze({
      workspaceRoot: resolve(config.workspaceRoot),
      realDataRoot: resolve(config.realDataRoot),
      fixtureRoot: resolve(config.fixtureRoot),
    }),
  );

export type StoragePathConfig = z.infer<typeof StoragePathConfigSchema>;

/** Creates the fixed, non-overlapping repository storage roots. */
export function createStoragePathConfig(workspaceRoot: string): StoragePathConfig {
  const absoluteWorkspaceRoot = AbsolutePathSchema.parse(workspaceRoot);

  return StoragePathConfigSchema.parse({
    workspaceRoot: absoluteWorkspaceRoot,
    realDataRoot: resolve(absoluteWorkspaceRoot, REAL_DATA_RELATIVE_ROOT),
    fixtureRoot: resolve(absoluteWorkspaceRoot, FIXTURE_RELATIVE_ROOT),
  });
}
