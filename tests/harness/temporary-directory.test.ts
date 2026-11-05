import { access, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertPathIsInOsTemporaryDirectory,
  createTemporaryTestDirectory,
  withTemporaryTestDirectory,
} from "./temporary-directory.js";

describe("temporary directory helper", () => {
  it("creates below os.tmpdir and removes callback artifacts", async () => {
    let createdPath = "";

    const result = await withTemporaryTestDirectory(async (path) => {
      createdPath = path;
      const pathFromTempRoot = relative(tmpdir(), path);

      expect(pathFromTempRoot).not.toBe("");
      expect(pathFromTempRoot.startsWith("..")).toBe(false);
      expect(isAbsolute(pathFromTempRoot)).toBe(false);
      await writeFile(join(path, "artifact.txt"), "temporary fixture", "utf8");
      return "done";
    }, "filesystem-smoke");

    expect(result).toBe("done");
    await expect(access(createdPath)).rejects.toThrow();
  });

  it("removes callback artifacts when the test body fails", async () => {
    let createdPath = "";

    await expect(
      withTemporaryTestDirectory(async (path) => {
        createdPath = path;
        await writeFile(join(path, "partial-artifact.txt"), "temporary", "utf8");
        throw new Error("fixture failure");
      }, "failure-cleanup"),
    ).rejects.toThrow("fixture failure");

    await expect(access(createdPath)).rejects.toThrow();
  });

  it("provides idempotent cleanup", async () => {
    const directory = await createTemporaryTestDirectory("cleanup");

    await directory.cleanup();
    await directory.cleanup();
    await expect(access(directory.path)).rejects.toThrow();
  });

  it("rejects the workspace real-data location without accessing it", () => {
    const realDataPath = fileURLToPath(
      new URL("../../data/real", import.meta.url),
    );

    expect(() => assertPathIsInOsTemporaryDirectory(realDataPath)).toThrow(
      /OS temporary directory/,
    );
  });
});
