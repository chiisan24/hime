import { dirname, join, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FIXTURE_RELATIVE_ROOT,
  REAL_DATA_RELATIVE_ROOT,
  StoragePathConfigSchema,
  createStoragePathConfig,
} from "./paths.js";

const workspaceRoot = resolve("virtual-workspace");
const realDataRoot = join(workspaceRoot, "data", "real");
const fixtureRoot = join(workspaceRoot, "packages", "fixtures");

function validConfig() {
  return {
    workspaceRoot,
    realDataRoot,
    fixtureRoot,
  };
}

describe("storage path configuration", () => {
  it("creates separate real-data and fixture roots inside the workspace", () => {
    expect(createStoragePathConfig(workspaceRoot)).toEqual({
      workspaceRoot,
      realDataRoot: resolve(workspaceRoot, REAL_DATA_RELATIVE_ROOT),
      fixtureRoot: resolve(workspaceRoot, FIXTURE_RELATIVE_ROOT),
    });
  });

  it("rejects equal and mutually contained storage roots", () => {
    const overlappingConfigs = [
      {
        ...validConfig(),
        fixtureRoot: realDataRoot,
      },
      {
        ...validConfig(),
        fixtureRoot: join(realDataRoot, "fixtures"),
      },
      {
        ...validConfig(),
        realDataRoot: join(fixtureRoot, "real"),
      },
    ];

    for (const config of overlappingConfigs) {
      const result = StoragePathConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
          "fixtureRoot",
        );
      }
    }
  });

  it("rejects real-data and fixture roots outside the workspace", () => {
    const outsideRoot = join(dirname(workspaceRoot), "outside");
    const escapedRoot = `${workspaceRoot}${sep}..${sep}outside`;

    const realResult = StoragePathConfigSchema.safeParse({
      ...validConfig(),
      realDataRoot: outsideRoot,
    });
    const fixtureResult = StoragePathConfigSchema.safeParse({
      ...validConfig(),
      fixtureRoot: escapedRoot,
    });

    expect(realResult.success).toBe(false);
    expect(fixtureResult.success).toBe(false);
  });

  it("rejects relative paths and unknown configuration fields", () => {
    expect(
      StoragePathConfigSchema.safeParse({
        ...validConfig(),
        workspaceRoot: "relative-workspace",
      }).success,
    ).toBe(false);

    expect(
      StoragePathConfigSchema.safeParse({
        ...validConfig(),
        otherRoot: join(workspaceRoot, "other"),
      }).success,
    ).toBe(false);
  });
});
