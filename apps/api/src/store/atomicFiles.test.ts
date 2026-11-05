import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { encodeCanonicalJson, sha256Hex } from "@ehime-vote-navigator/domain";
import { describe, expect, it } from "vitest";

import { withTemporaryTestDirectory } from "../../../../tests/harness/temporary-directory.js";
import {
  AtomicFileError,
  atomicWriteImmutableFile,
  createContentAddressedRelativePath,
  writeContentAddressedFile,
  type AtomicFileOperationOverrides,
} from "./atomicFiles.js";

async function expectMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toThrow();
}

async function expectAtomicError(
  operation: Promise<unknown>,
  code: AtomicFileError["code"],
): Promise<void> {
  try {
    await operation;
    throw new Error("Expected the atomic file operation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(AtomicFileError);
    expect((error as AtomicFileError).code).toBe(code);
  }
}

async function createAllowedRoot(temporaryRoot: string): Promise<string> {
  const allowedRoot = join(temporaryRoot, "allowed");
  await mkdir(allowedRoot);
  return allowedRoot;
}

function temporaryHandleFault(
  stage: "close" | "sync" | "write",
): AtomicFileOperationOverrides {
  return {
    openExclusive: async (path) => {
      const handle = await open(path, "wx");
      return {
        close:
          stage === "close"
            ? async () => {
                await handle.close();
                throw new Error("injected close failure");
              }
            : async () => handle.close(),
        sync:
          stage === "sync"
            ? async () => {
                throw new Error("injected sync failure");
              }
            : async () => handle.sync(),
        writeFile:
          stage === "write"
            ? async () => {
                throw new Error("injected write failure");
              }
            : async (bytes) => handle.writeFile(bytes),
      };
    },
  };
}

describe("content-addressed paths", () => {
  it("derives a stable, sharded relative path from lowercase SHA-256", () => {
    const hash = sha256Hex("content");

    expect(
      createContentAddressedRelativePath(hash, {
        directory: "approvals/objects",
        extension: ".json",
      }),
    ).toBe(`approvals/objects/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.json`);
  });

  it.each([
    "ABCDEF0000000000000000000000000000000000000000000000000000000000",
    "too-short",
    "../outside",
  ])("rejects an invalid content hash", (hash) => {
    expect(() => createContentAddressedRelativePath(hash)).toThrow(
      AtomicFileError,
    );
  });

  it("rejects unsafe directory and extension options", () => {
    const hash = sha256Hex("content");

    expect(() =>
      createContentAddressedRelativePath(hash, { directory: "../outside" }),
    ).toThrow(AtomicFileError);
    expect(() =>
      createContentAddressedRelativePath(hash, { extension: ".json/other" }),
    ).toThrow(AtomicFileError);
  });
});

describe("atomic immutable files", () => {
  it("writes, synchronizes, closes, renames, verifies, then creates the marker", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const allowedRoot = await createAllowedRoot(temporaryRoot);
      const bytes = encodeCanonicalJson({ sequence: 1, value: "架空データ" });
      const relativePath = "events/000001.json";
      const markerRelativePath = "events/COMMITTED.json";

      const result = await atomicWriteImmutableFile({
        allowedRoot,
        bytes,
        commitMarkerRelativePath: markerRelativePath,
        expectedContentHash: sha256Hex(bytes),
        relativePath,
      });

      expect(result).toMatchObject({
        commitMarkerState: "created",
        contentHash: sha256Hex(bytes),
        relativePath,
        state: "created",
      });
      expect(await readFile(join(allowedRoot, relativePath))).toEqual(
        Buffer.from(bytes),
      );
      expect(await readFile(join(allowedRoot, markerRelativePath))).toEqual(
        Buffer.from(
          encodeCanonicalJson({
            contentHash: sha256Hex(bytes),
            target: relativePath,
          }),
        ),
      );
    }, "atomic-success");
  });

  it("uses a unique sibling temporary file for each rename", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const allowedRoot = await createAllowedRoot(temporaryRoot);
      const renames: Array<readonly [string, string]> = [];
      const operations: AtomicFileOperationOverrides = {
        rename: async (temporaryPath, finalPath) => {
          renames.push([temporaryPath, finalPath]);
          const { rename } = await import("node:fs/promises");
          await rename(temporaryPath, finalPath);
        },
      };

      await atomicWriteImmutableFile({
        allowedRoot,
        bytes: new TextEncoder().encode("first"),
        operations,
        relativePath: "objects/first.bin",
      });
      await atomicWriteImmutableFile({
        allowedRoot,
        bytes: new TextEncoder().encode("second"),
        operations,
        relativePath: "objects/second.bin",
      });

      expect(renames).toHaveLength(2);
      expect(dirname(renames[0]![0])).toBe(dirname(renames[0]![1]));
      expect(dirname(renames[1]![0])).toBe(dirname(renames[1]![1]));
      expect(renames[0]![0]).not.toBe(renames[1]![0]);
      expect(renames.every(([temporary]) => temporary.endsWith(".tmp"))).toBe(
        true,
      );
    }, "atomic-sibling-temp");
  });

  it("writes content-addressed bytes to their derived path", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const allowedRoot = await createAllowedRoot(temporaryRoot);
      const bytes = encodeCanonicalJson({ value: "content addressed" });
      const hash = sha256Hex(bytes);

      const result = await writeContentAddressedFile({
        allowedRoot,
        bytes,
        directory: "artifacts",
      });

      expect(result.relativePath).toBe(
        createContentAddressedRelativePath(hash, { directory: "artifacts" }),
      );
      expect(await readFile(result.absolutePath)).toEqual(Buffer.from(bytes));
    }, "content-addressed-write");
  });

  it("treats byte-identical existing content and marker as idempotent", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const allowedRoot = await createAllowedRoot(temporaryRoot);
      const bytes = new TextEncoder().encode("immutable bytes\n");
      const options = {
        allowedRoot,
        bytes,
        commitMarkerRelativePath: "records/COMMITTED.json",
        relativePath: "records/value.json",
      } as const;

      await atomicWriteImmutableFile(options);
      const second = await atomicWriteImmutableFile(options);

      expect(second.state).toBe("already-present");
      expect(second.commitMarkerState).toBe("already-present");
      expect(await readFile(join(allowedRoot, options.relativePath))).toEqual(
        Buffer.from(bytes),
      );
    }, "atomic-idempotent");
  });

  it("rejects different bytes at an existing immutable path without changing them", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const allowedRoot = await createAllowedRoot(temporaryRoot);
      const finalPath = join(allowedRoot, "immutable/value.json");
      const original = new TextEncoder().encode("original\n");

      await atomicWriteImmutableFile({
        allowedRoot,
        bytes: original,
        relativePath: "immutable/value.json",
      });

      await expectAtomicError(
        atomicWriteImmutableFile({
          allowedRoot,
          bytes: new TextEncoder().encode("replacement\n"),
          relativePath: "immutable/value.json",
        }),
        "IMMUTABLE_CONFLICT",
      );

      expect(await readFile(finalPath)).toEqual(Buffer.from(original));
    }, "atomic-conflict");
  });

  it("rejects a mismatched expected hash before creating a file", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const allowedRoot = await createAllowedRoot(temporaryRoot);
      const relativePath = "objects/value.json";

      await expectAtomicError(
        atomicWriteImmutableFile({
          allowedRoot,
          bytes: new TextEncoder().encode("actual"),
          expectedContentHash: sha256Hex("different"),
          relativePath,
        }),
        "CONTENT_HASH_MISMATCH",
      );
      await expectMissing(join(allowedRoot, relativePath));
    }, "atomic-hash-mismatch");
  });

  it.each(["../outside.json", "nested/../../outside.json"])(
    "rejects traversal path %s without writing outside the root",
    async (relativePath) => {
      await withTemporaryTestDirectory(async (temporaryRoot) => {
        const allowedRoot = await createAllowedRoot(temporaryRoot);
        const outsidePath = join(temporaryRoot, "outside.json");

        await expectAtomicError(
          atomicWriteImmutableFile({
            allowedRoot,
            bytes: new TextEncoder().encode("blocked"),
            relativePath,
          }),
          "INVALID_RELATIVE_PATH",
        );
        await expectMissing(outsidePath);
      }, "atomic-traversal");
    },
  );

  it("rejects absolute destination paths", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const allowedRoot = await createAllowedRoot(temporaryRoot);
      const absoluteDestination = join(temporaryRoot, "absolute.json");

      await expectAtomicError(
        atomicWriteImmutableFile({
          allowedRoot,
          bytes: new TextEncoder().encode("blocked"),
          relativePath: absoluteDestination,
        }),
        "INVALID_RELATIVE_PATH",
      );
      await expectMissing(absoluteDestination);
    }, "atomic-absolute");
  });

  it("rejects a symbolic-link directory that escapes the allowed root", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const allowedRoot = await createAllowedRoot(temporaryRoot);
      const outsideRoot = join(temporaryRoot, "outside");
      const linkedDirectory = join(allowedRoot, "linked");
      const escapedFile = join(outsideRoot, "escaped.json");
      await mkdir(outsideRoot);
      await symlink(
        outsideRoot,
        linkedDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );

      await expectAtomicError(
        atomicWriteImmutableFile({
          allowedRoot,
          bytes: new TextEncoder().encode("blocked"),
          relativePath: "linked/escaped.json",
        }),
        "SYMLINK_NOT_ALLOWED",
      );
      await expectMissing(escapedFile);
    }, "atomic-symlink");
  });

  it.each([
    ["write", "TEMPORARY_WRITE_FAILED"],
    ["sync", "TEMPORARY_SYNC_FAILED"],
    ["close", "TEMPORARY_CLOSE_FAILED"],
  ] as const)(
    "leaves no final or marker after an injected temporary %s failure",
    async (stage, code) => {
      await withTemporaryTestDirectory(async (temporaryRoot) => {
        const allowedRoot = await createAllowedRoot(temporaryRoot);
        const relativePath = "faults/value.json";
        const markerPath = "faults/COMMITTED.json";
        const sentinelPath = join(allowedRoot, "sentinel.txt");
        await writeFile(sentinelPath, "keep", "utf8");

        await expectAtomicError(
          atomicWriteImmutableFile({
            allowedRoot,
            bytes: new TextEncoder().encode("new bytes"),
            commitMarkerRelativePath: markerPath,
            operations: temporaryHandleFault(stage),
            relativePath,
          }),
          code,
        );

        await expectMissing(join(allowedRoot, relativePath));
        await expectMissing(join(allowedRoot, markerPath));
        expect(await readFile(sentinelPath, "utf8")).toBe("keep");
        const entries = await readdir(allowedRoot, { recursive: true });
        expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
      }, `atomic-${stage}-fault`);
    },
  );

  it("leaves no final or marker after an injected rename failure", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const allowedRoot = await createAllowedRoot(temporaryRoot);
      const relativePath = "faults/value.json";
      const markerPath = "faults/COMMITTED.json";

      await expectAtomicError(
        atomicWriteImmutableFile({
          allowedRoot,
          bytes: new TextEncoder().encode("new bytes"),
          commitMarkerRelativePath: markerPath,
          operations: {
            rename: async () => {
              throw new Error("injected rename failure");
            },
          },
          relativePath,
        }),
        "ATOMIC_RENAME_FAILED",
      );

      await expectMissing(join(allowedRoot, relativePath));
      await expectMissing(join(allowedRoot, markerPath));
      const entries = await readdir(allowedRoot, { recursive: true });
      expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
    }, "atomic-rename-fault");
  });

  it("rolls back a newly-created final file when marker creation fails", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const allowedRoot = await createAllowedRoot(temporaryRoot);
      const relativePath = "transaction/value.json";
      const markerPath = "transaction/COMMITTED.json";
      const absoluteMarkerPath = join(allowedRoot, markerPath);

      await expectAtomicError(
        atomicWriteImmutableFile({
          allowedRoot,
          bytes: new TextEncoder().encode("new bytes"),
          commitMarkerRelativePath: markerPath,
          operations: {
            openExclusive: async (path) => {
              const handle = await open(path, "wx");
              return {
                close: async () => handle.close(),
                sync: async () => handle.sync(),
                writeFile:
                  path === absoluteMarkerPath
                    ? async () => {
                        throw new Error("injected marker failure");
                      }
                    : async (bytes) => handle.writeFile(bytes),
              };
            },
          },
          relativePath,
        }),
        "COMMIT_MARKER_FAILED",
      );

      await expectMissing(join(allowedRoot, relativePath));
      await expectMissing(absoluteMarkerPath);
    }, "atomic-marker-fault");
  });

  it("preserves an identical pre-existing final file when marker creation fails", async () => {
    await withTemporaryTestDirectory(async (temporaryRoot) => {
      const allowedRoot = await createAllowedRoot(temporaryRoot);
      const relativePath = "transaction/value.json";
      const markerPath = "transaction/COMMITTED.json";
      const absoluteMarkerPath = join(allowedRoot, markerPath);
      const bytes = new TextEncoder().encode("existing bytes");

      await atomicWriteImmutableFile({ allowedRoot, bytes, relativePath });
      await expectAtomicError(
        atomicWriteImmutableFile({
          allowedRoot,
          bytes,
          commitMarkerRelativePath: markerPath,
          operations: {
            openExclusive: async (path) => {
              const handle = await open(path, "wx");
              return {
                close: async () => handle.close(),
                sync: async () => handle.sync(),
                writeFile:
                  path === absoluteMarkerPath
                    ? async () => {
                        throw new Error("injected marker failure");
                      }
                    : async (input) => handle.writeFile(input),
              };
            },
          },
          relativePath,
        }),
        "COMMIT_MARKER_FAILED",
      );

      expect(await readFile(join(allowedRoot, relativePath))).toEqual(
        Buffer.from(bytes),
      );
      await expectMissing(absoluteMarkerPath);
    }, "atomic-existing-marker-fault");
  });
});
