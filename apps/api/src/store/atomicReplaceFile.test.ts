import { mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { sha256Hex } from "@ehime-vote-navigator/domain";
import { describe, expect, it } from "vitest";

import { withTemporaryTestDirectory } from "../../../../tests/harness/temporary-directory.js";
import {
  AtomicFileError,
  type AtomicFileOperationOverrides,
} from "./atomicFiles.js";
import { atomicReplaceFile } from "./atomicReplaceFile.js";

const RELATIVE_PATH = "config/election/elections.json";
const OLD_TEXT = "old registry bytes\n";
const NEW_TEXT = "new registry bytes\n";

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function createRoot(base: string): Promise<string> {
  const root = join(base, "root");
  await mkdir(root);
  return root;
}

async function seedTarget(root: string, text: string): Promise<string> {
  await mkdir(join(root, "config", "election"), { recursive: true });
  const target = join(root, "config", "election", "elections.json");
  await writeFile(target, text);
  return target;
}

async function expectOnlyTarget(root: string): Promise<void> {
  expect(await readdir(join(root, "config", "election"))).toEqual([
    "elections.json",
  ]);
}

async function failureOf(operation: Promise<unknown>): Promise<AtomicFileError> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof AtomicFileError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the operation to fail.");
}

function faultyHandle(stage: "sync" | "write"): AtomicFileOperationOverrides {
  return {
    openExclusive: async (path) => {
      const handle = await open(path, "wx");
      return {
        close: async () => {
          await handle.close();
        },
        sync: async () => {
          if (stage === "sync") {
            throw new Error("sync failed");
          }
          await handle.sync();
        },
        writeFile: async (bytes) => {
          if (stage === "write") {
            throw new Error("disk full");
          }
          await handle.writeFile(bytes);
        },
      };
    },
  };
}

describe("atomicReplaceFile", () => {
  it("creates a missing file together with its directories", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createRoot(base);

      const result = await atomicReplaceFile({
        allowedRoot: root,
        bytes: encode(NEW_TEXT),
        relativePath: RELATIVE_PATH,
      });

      expect(result.state).toBe("created");
      expect(result.relativePath).toBe(RELATIVE_PATH);
      expect(result.contentHash).toBe(sha256Hex(encode(NEW_TEXT)));
      expect(await readFile(result.absolutePath, "utf8")).toBe(NEW_TEXT);
      await expectOnlyTarget(root);
    }, "replace-create");
  });

  it("replaces an existing file with exactly the new bytes", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createRoot(base);
      const target = await seedTarget(root, OLD_TEXT);

      const result = await atomicReplaceFile({
        allowedRoot: root,
        bytes: encode(NEW_TEXT),
        relativePath: RELATIVE_PATH,
      });

      expect(result.state).toBe("replaced");
      expect(await readFile(target, "utf8")).toBe(NEW_TEXT);
      await expectOnlyTarget(root);
    }, "replace-existing");
  });

  it("leaves the original bytes and no temporary file after a rename failure", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createRoot(base);
      const target = await seedTarget(root, OLD_TEXT);

      const error = await failureOf(
        atomicReplaceFile({
          allowedRoot: root,
          bytes: encode(NEW_TEXT),
          operations: {
            rename: async () => {
              throw new Error("rename blocked");
            },
          },
          relativePath: RELATIVE_PATH,
        }),
      );

      expect(error.code).toBe("ATOMIC_RENAME_FAILED");
      expect(await readFile(target, "utf8")).toBe(OLD_TEXT);
      await expectOnlyTarget(root);
    }, "replace-rename-fail");
  });

  it.each([
    ["write", "TEMPORARY_WRITE_FAILED"],
    ["sync", "TEMPORARY_SYNC_FAILED"],
  ] as const)(
    "leaves the original bytes after an injected temporary %s failure",
    async (stage, code) => {
      await withTemporaryTestDirectory(async (base) => {
        const root = await createRoot(base);
        const target = await seedTarget(root, OLD_TEXT);

        const error = await failureOf(
          atomicReplaceFile({
            allowedRoot: root,
            bytes: encode(NEW_TEXT),
            operations: faultyHandle(stage),
            relativePath: RELATIVE_PATH,
          }),
        );

        expect(error.code).toBe(code);
        expect(await readFile(target, "utf8")).toBe(OLD_TEXT);
        await expectOnlyTarget(root);
      }, "replace-temp-fail");
    },
  );

  it("rejects a temporary file whose read-back bytes differ and keeps the original", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createRoot(base);
      const target = await seedTarget(root, OLD_TEXT);

      const error = await failureOf(
        atomicReplaceFile({
          allowedRoot: root,
          bytes: encode(NEW_TEXT),
          operations: { readFile: async () => encode("corrupted") },
          relativePath: RELATIVE_PATH,
        }),
      );

      expect(error.code).toBe("TEMPORARY_WRITE_FAILED");
      expect(await readFile(target, "utf8")).toBe(OLD_TEXT);
      await expectOnlyTarget(root);
    }, "replace-verify-fail");
  });

  it("uses fixed messages that do not expose filesystem paths", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createRoot(base);
      await seedTarget(root, OLD_TEXT);

      const error = await failureOf(
        atomicReplaceFile({
          allowedRoot: root,
          bytes: encode(NEW_TEXT),
          operations: {
            rename: async () => {
              throw new Error(`blocked at ${root}`);
            },
          },
          relativePath: RELATIVE_PATH,
        }),
      );

      expect(error.message).not.toContain(root);
      expect(error.message).not.toContain("blocked");
    }, "replace-message");
  });

  it.each([
    "../outside.json",
    "config/../../outside.json",
    "/absolute.json",
    "C:\\absolute.json",
    "con.json",
    "config/nul",
    "trailing-dot.",
    "has space.json",
    " leading.json",
    "",
  ])("rejects the unsafe relative path %j without writing", async (relativePath) => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createRoot(base);

      const error = await failureOf(
        atomicReplaceFile({
          allowedRoot: root,
          bytes: encode(NEW_TEXT),
          relativePath,
        }),
      );

      expect(error.code).toBe("INVALID_RELATIVE_PATH");
      expect(await readdir(root)).toEqual([]);
      expect(await readdir(base)).toEqual(["root"]);
    }, "replace-bad-path");
  });

  it("rejects a missing or relative allowed root", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const missing = await failureOf(
        atomicReplaceFile({
          allowedRoot: join(base, "does-not-exist"),
          bytes: encode(NEW_TEXT),
          relativePath: RELATIVE_PATH,
        }),
      );
      const relativeRoot = await failureOf(
        atomicReplaceFile({
          allowedRoot: "relative/root",
          bytes: encode(NEW_TEXT),
          relativePath: RELATIVE_PATH,
        }),
      );

      expect(missing.code).toBe("INVALID_ROOT");
      expect(relativeRoot.code).toBe("INVALID_ROOT");
    }, "replace-bad-root");
  });

  it("refuses to replace a directory that sits at the target path", async () => {
    await withTemporaryTestDirectory(async (base) => {
      const root = await createRoot(base);
      await mkdir(join(root, "config", "election", "elections.json"), {
        recursive: true,
      });

      const error = await failureOf(
        atomicReplaceFile({
          allowedRoot: root,
          bytes: encode(NEW_TEXT),
          relativePath: RELATIVE_PATH,
        }),
      );

      expect(error.code).toBe("FILESYSTEM_ERROR");
      expect(await readdir(join(root, "config", "election"))).toEqual([
        "elections.json",
      ]);
    }, "replace-directory");
  });
});