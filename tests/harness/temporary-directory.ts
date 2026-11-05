import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const TEST_DIRECTORY_PREFIX = "ehime-vote-navigator-test-";

export type TemporaryTestDirectory = Readonly<{
  cleanup: () => Promise<void>;
  path: string;
}>;

function isDescendant(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

/** Rejects paths outside the operating system's temporary directory. */
export function assertPathIsInOsTemporaryDirectory(candidatePath: string): void {
  const temporaryRoot = resolve(tmpdir());
  const resolvedCandidate = resolve(candidatePath);

  if (!isDescendant(temporaryRoot, resolvedCandidate)) {
    throw new Error(
      `Test filesystem access must stay below the OS temporary directory: ${resolvedCandidate}`,
    );
  }
}

function safeLabel(label: string): string {
  const sanitized = label.replaceAll(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);
  return sanitized === "" ? "case" : sanitized;
}

/** Creates an isolated directory below os.tmpdir() with idempotent cleanup. */
export async function createTemporaryTestDirectory(
  label = "case",
): Promise<TemporaryTestDirectory> {
  const path = await mkdtemp(
    join(tmpdir(), `${TEST_DIRECTORY_PREFIX}${safeLabel(label)}-`),
  );
  assertPathIsInOsTemporaryDirectory(path);

  let cleaned = false;
  return {
    path,
    cleanup: async () => {
      if (cleaned) {
        return;
      }

      cleaned = true;
      await rm(path, { force: true, recursive: true });
    },
  };
}

/** Runs a filesystem test in os.tmpdir() and always removes its artifacts. */
export async function withTemporaryTestDirectory<T>(
  run: (path: string) => Promise<T> | T,
  label = "case",
): Promise<T> {
  const directory = await createTemporaryTestDirectory(label);

  try {
    return await run(directory.path);
  } finally {
    await directory.cleanup();
  }
}
