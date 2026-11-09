import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  decideChange,
  loadRegistry,
  proposeChange,
  type ChangeProposal,
  type RegistryConfigError,
  type Result,
  type ValidatedRegistry,
} from "@ehime-vote-navigator/domain";

import {
  AtomicFileError,
  type AtomicFileErrorCode,
  type AtomicFileOperationOverrides,
} from "../store/atomicFiles.js";
import {
  atomicReplaceFile,
  type AtomicReplaceResult,
} from "../store/atomicReplaceFile.js";

/** Tracked election registry, relative to the workspace root. */
export const REGISTRY_RELATIVE_PATH = "config/election/elections.json";

export type RegistryFileErrorCode =
  | "REGISTRY_FILE_MISSING"
  | "REGISTRY_FILE_UNREADABLE"
  | "REGISTRY_JSON_INVALID";

export type RegistryFileError = Readonly<{
  code: RegistryFileErrorCode;
  safeMessage: string;
}>;

/** A read failure, or the violations found by `loadRegistry`. */
export type RegistryLoadError = RegistryFileError | RegistryConfigError;

export type RegistryWriteError = Readonly<{
  code: "UPDATE_FAILED";
  storageCode: AtomicFileErrorCode | "UNKNOWN";
  safeMessage: string;
}>;

export type RegistryFileOptions = Readonly<{
  /** Test seam for the filesystem write; the real filesystem is the default. */
  operations?: AtomicFileOperationOverrides;
  /** Test seam for reading the registry text. */
  readFile?: (absolutePath: string) => Promise<string>;
  workspaceRoot: string;
}>;

const FILE_ERROR_MESSAGES: Readonly<Record<RegistryFileErrorCode, string>> =
  Object.freeze({
    REGISTRY_FILE_MISSING: "The election registry file does not exist.",
    REGISTRY_FILE_UNREADABLE: "The election registry file could not be read.",
    REGISTRY_JSON_INVALID: "The election registry file is not valid JSON.",
  });

const UPDATE_FAILED_MESSAGE =
  "The election registry could not be saved, so the registry file was left unchanged.";

function fileError(code: RegistryFileErrorCode): Result<never, RegistryFileError> {
  return {
    ok: false,
    error: Object.freeze({ code, safeMessage: FILE_ERROR_MESSAGES[code] }),
  };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function registryPath(workspaceRoot: string): string {
  return resolve(workspaceRoot, ...REGISTRY_RELATIVE_PATH.split("/"));
}

/**
 * Reads and validates `config/election/elections.json`. Fail closed: any read,
 * JSON or contract problem yields an error and no registry, so no caller can
 * continue with unvalidated election data.
 */
export async function readRegistryFile(
  options: RegistryFileOptions,
): Promise<Result<ValidatedRegistry, RegistryLoadError>> {
  const read = options.readFile ?? ((path: string) => readFile(path, "utf8"));

  let text: string;
  try {
    text = await read(registryPath(options.workspaceRoot));
  } catch (error) {
    return fileError(
      hasErrorCode(error, "ENOENT")
        ? "REGISTRY_FILE_MISSING"
        : "REGISTRY_FILE_UNREADABLE",
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return fileError("REGISTRY_JSON_INVALID");
  }

  return loadRegistry(data);
}

/** Stable, human-readable serialization (fixed key order, trailing newline). */
export function serializeRegistry(registry: ValidatedRegistry): Uint8Array {
  const body = {
    schemaVersion: registry.schemaVersion,
    elections: registry.elections.map((election) => ({
      electionId: election.electionId,
      name: election.name,
      electionDate: election.electionDate,
      status: election.status,
      candidates: election.candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        name: candidate.name,
        nameForms: [...candidate.nameForms],
      })),
    })),
  };

  return new TextEncoder().encode(`${JSON.stringify(body, null, 2)}\n`);
}

/**
 * Replaces the registry file in one atomic step. On any failure the previous
 * file is left exactly as it was.
 */
export async function writeRegistryFile(
  options: RegistryFileOptions & Readonly<{ registry: ValidatedRegistry }>,
): Promise<Result<AtomicReplaceResult, RegistryWriteError>> {
  try {
    const written = await atomicReplaceFile({
      allowedRoot: options.workspaceRoot,
      bytes: serializeRegistry(options.registry),
      relativePath: REGISTRY_RELATIVE_PATH,
      ...(options.operations === undefined
        ? {}
        : { operations: options.operations }),
    });

    return { ok: true, value: written };
  } catch (error) {
    return {
      ok: false,
      error: Object.freeze({
        code: "UPDATE_FAILED" as const,
        storageCode:
          error instanceof AtomicFileError ? error.code : ("UNKNOWN" as const),
        safeMessage: UPDATE_FAILED_MESSAGE,
      }),
    };
  }
}

export type ElectionChangeOptions = RegistryFileOptions &
  Readonly<{
    /** Shows the before/after election and returns true only on approval. */
    confirm: (proposal: ChangeProposal) => Promise<boolean>;
    toElectionId: string;
  }>;

export type ElectionChangeOutcome =
  | Readonly<{ status: "CHANGED"; proposal: ChangeProposal }>
  | Readonly<{
      status: "NOT_CHANGED";
      reason: "REJECTED" | "TARGET_INVALID" | "UPDATE_FAILED";
      proposal?: ChangeProposal;
      safeMessage: string;
    }>
  | Readonly<{ status: "CONFIG_ERROR"; error: RegistryLoadError }>;

/**
 * Proposes, asks for approval, and only then saves a current-election change.
 * Nothing is written unless the proposal is approved and valid; a rejection,
 * an invalid target, an invalid registry or a failed save all leave the
 * registry file untouched.
 */
export async function applyElectionChange(
  options: ElectionChangeOptions,
): Promise<ElectionChangeOutcome> {
  const loaded = await readRegistryFile(options);
  if (!loaded.ok) {
    return { status: "CONFIG_ERROR", error: loaded.error };
  }
  const registry = loaded.value;

  const proposed = proposeChange(registry, options.toElectionId);
  if (!proposed.ok) {
    return {
      status: "NOT_CHANGED",
      reason: "TARGET_INVALID",
      safeMessage: proposed.error.safeMessage,
    };
  }
  const proposal = proposed.value;

  let approved = false;
  try {
    approved = (await options.confirm(proposal)) === true;
  } catch {
    approved = false;
  }

  const decided = decideChange(
    registry,
    proposal,
    approved ? "APPROVE" : "REJECT",
  );
  if (!decided.ok) {
    return {
      status: "NOT_CHANGED",
      reason: decided.error.reason,
      proposal,
      safeMessage: decided.error.safeMessage,
    };
  }

  const written = await writeRegistryFile({
    ...options,
    registry: decided.value,
  });
  if (!written.ok) {
    return {
      status: "NOT_CHANGED",
      reason: "UPDATE_FAILED",
      proposal,
      safeMessage: written.error.safeMessage,
    };
  }

  return { status: "CHANGED", proposal };
}