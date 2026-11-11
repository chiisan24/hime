import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { sha256Hex, type Result } from "@ehime-vote-navigator/domain";

import { createStoragePathConfig } from "../config/paths.js";
import {
  applyElectionChange,
  readRegistryFile,
  type RegistryFileOptions,
  type RegistryLoadError,
} from "../election/registryFile.js";
import { ingest, type IngestRejection, type IngestRequest } from "../ingest/ingest.js";
import { createFileIngestStore } from "../ingest/ingestStore.js";
import { createManualPlacementSupplier } from "../ingest/manualPlacementSupplier.js";
import { INJECTED_EXTRACTOR_ID, extractAndStore } from "../extract/storedExtraction.js";
import { PDFJS_EXTRACTOR_ID, createPdfjsTextExtractor } from "../extract/pdfjsTextExtractor.js";
import type { PdfTextExtractor } from "../extract/pdfTextExtractor.js";
import type { SupplyError } from "../ingest/sourceSupplier.js";
import type { AtomicFileOperationOverrides } from "../store/atomicFiles.js";
import { OCR_MODEL_RELATIVE_DIRECTORY } from "../ocr/modelManifest.js";
import type { OcrSettings } from "../ocr/ocrConfig.js";
import type { OcrError, OcrSession, PageRasterizer } from "../ocr/ocrTypes.js";
import { createPaddleOcrEngine } from "../ocr/paddleOcrEngine.js";
import { createPdfjsPageRasterizer } from "../ocr/pdfjsPageRasterizer.js";
import { createTracer, type Tracer } from "../ocr/trace.js";
import { inspectPdf, parseInspectArgs } from "./inspectCommand.js";
import { runOcrCommand } from "./ocrCommand.js";
import { createFileStageStore } from "./stageStore.js";

/** Terminal boundary of the analysis CLI; tests replace it with a fake. */
export type CliIo = Readonly<{
  /** Asks a yes/no question. Anything but an explicit yes must resolve false. */
  confirm: (question: string) => Promise<boolean>;
  write: (line: string) => void;
}>;

export type CliOptions = Readonly<{
  /** Test seam for the OCR engine; PaddleOCR with the downloaded models is used by default. */
  createOcrSession?: (settings: OcrSettings, trace: Tracer) => Promise<Result<OcrSession, OcrError>>;
  /** Test seam for the PDF text extractor; pdfjs-dist is used by default. */
  extractor?: PdfTextExtractor;
  /** Test seam for the ingest writes; the real filesystem is the default. */
  ingestOperations?: AtomicFileOperationOverrides;
  io: CliIo;
  /** Test seam for the retrieval time; defaults to the current time. */
  now?: () => Date;
  /** Set to trace an OCR run (step times, memory, heartbeat). Lines hold no page text. */
  ocrTrace?: Readonly<{ write: (line: string) => void }>;
  /** Test seam for the page renderer; pdfjs-dist is used by default. */
  rasterizer?: PageRasterizer;
  /** Test seams for the registry file; the real filesystem is the default. */
  registry?: Pick<RegistryFileOptions, "operations" | "readFile">;
  /** Test seam for the stage store and review file writes; the real filesystem is the default. */
  stageOperations?: AtomicFileOperationOverrides;
  workspaceRoot: string;
}>;

const USAGE_LINES: readonly string[] = [
  "Usage: npm run analysis -- <command>",
  "  election show                   List the registered elections",
  "  election change <electionId>    Change the current election after approval",
  "  ingest <file.pdf> --election <electionId> --source <sourceId> --url <officialUrl>",
  "         [--candidate <candidateId> | --shared] [--retrieved-at <ISO 8601 time>]",
  "                                   Register a PDF placed in data/real/raw",
  "  extract --source <sourceId> [--revision <rN>]",
  "                                   Read the PDF text layer by page and save it (counts only)",
  "  inspect --file <file.pdf> [--write-review]",
  "                                   Check the text layer of a PDF in data/real/raw (counts only)",
  "  ocr trial --file <file.pdf> --region <id>=<page>:<x0>,<y0>,<x1>,<y1> [--region ...]",
  "            [--dpi <n>] [--strategy per-line|per-box]",
  "                                   Run OCR on a few parts of a PDF and save images for checking (counts only)",
  "  ocr truth --file <file.pdf> --region <id>",
  "                                   Create the text file in which a person types the true text of a region",
  "  ocr compare --file <file.pdf> [--min-f1 <0-1>] [--dpi <n>] [--strategy per-line|per-box]",
  "                                   Score a trial against the text a person typed (counts only)",
];

function registryOptions(options: CliOptions): RegistryFileOptions {
  return { workspaceRoot: options.workspaceRoot, ...options.registry };
}

function reportLoadError(io: CliIo, error: RegistryLoadError): void {
  io.write(`Election registry error: ${error.code}`);
  if (error.code === "REGISTRY_CONFIG_INVALID") {
    for (const violation of error.violations) {
      io.write(`  violation: ${violation}`);
    }
  }
  io.write(error.safeMessage);
  io.write("No election data is used until the registry is fixed.");
}

async function showElections(options: CliOptions): Promise<number> {
  const loaded = await readRegistryFile(registryOptions(options));
  if (!loaded.ok) {
    reportLoadError(options.io, loaded.error);
    return 1;
  }

  for (const election of loaded.value.elections) {
    options.io.write(
      `${election.status} ${election.electionId} ${election.electionDate} candidates=${election.candidates.length} ${election.name}`,
    );
  }
  return 0;
}

async function changeElection(
  toElectionId: string,
  options: CliOptions,
): Promise<number> {
  const { io } = options;
  const outcome = await applyElectionChange({
    ...registryOptions(options),
    toElectionId,
    confirm: async (proposal) => {
      io.write(
        `Current election : ${proposal.from.electionId} ${proposal.from.name}`,
      );
      io.write(
        `Proposed election: ${proposal.to.electionId} ${proposal.to.name}`,
      );
      io.write("Nothing is saved unless you approve this change.");
      return io.confirm("Approve this change? [y/N] ");
    },
  });

  if (outcome.status === "CHANGED") {
    io.write("The current election was changed and saved.");
    return 0;
  }

  if (outcome.status === "CONFIG_ERROR") {
    reportLoadError(io, outcome.error);
    return 1;
  }

  io.write(`Not changed: ${outcome.reason}`);
  io.write(outcome.safeMessage);
  io.write("The election registry file was left as it was.");
  return 1;
}

type IngestArgs = Readonly<{
  candidateId?: string;
  electionId: string;
  file: string;
  officialUrl?: string;
  retrievedAt?: string;
  shared: boolean;
  sourceId: string;
}>;

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--election",
  "--source",
  "--candidate",
  "--url",
  "--retrieved-at",
]);

function parseIngestArgs(args: readonly string[]): IngestArgs | undefined {
  const values = new Map<string, string>();
  const positional: string[] = [];
  let shared = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--shared") {
      shared = true;
    } else if (VALUE_FLAGS.has(arg)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--") || values.has(arg)) {
        return undefined;
      }
      values.set(arg, value);
      index += 1;
    } else if (arg.startsWith("--")) {
      return undefined;
    } else {
      positional.push(arg);
    }
  }

  const file = positional[0];
  const electionId = values.get("--election");
  const sourceId = values.get("--source");
  const candidateId = values.get("--candidate");
  const officialUrl = values.get("--url");
  const retrievedAt = values.get("--retrieved-at");
  if (
    positional.length !== 1 ||
    file === undefined ||
    electionId === undefined ||
    sourceId === undefined ||
    (shared && candidateId !== undefined)
  ) {
    return undefined;
  }

  return {
    electionId,
    file,
    shared,
    sourceId,
    ...(candidateId === undefined ? {} : { candidateId }),
    ...(officialUrl === undefined ? {} : { officialUrl }),
    ...(retrievedAt === undefined ? {} : { retrievedAt }),
  };
}

function reportIngestFailure(
  io: CliIo,
  failure: IngestRejection | SupplyError,
): void {
  io.write(`Ingest rejected: ${failure.code}`);
  if (failure.fields !== undefined && failure.fields.length > 0) {
    io.write(`  items: ${failure.fields.join(", ")}`);
  }
  if ("existingSourceId" in failure && failure.existingSourceId !== undefined) {
    io.write(`  already registered as source: ${failure.existingSourceId}`);
  }
  io.write(failure.safeMessage);
  io.write("Nothing was saved.");
}

async function ingestDocument(
  args: readonly string[],
  options: CliOptions,
): Promise<number> {
  const { io } = options;
  const parsed = parseIngestArgs(args);
  if (parsed === undefined) {
    for (const line of USAGE_LINES) {
      io.write(line);
    }
    return 1;
  }

  const loaded = await readRegistryFile(registryOptions(options));
  if (!loaded.ok) {
    reportLoadError(io, loaded.error);
    return 1;
  }

  const storage = createStoragePathConfig(options.workspaceRoot);
  const supplier = createManualPlacementSupplier({
    rawDirectory: join(storage.realDataRoot, "raw"),
    ...(parsed.officialUrl === undefined ? {} : { officialUrl: parsed.officialUrl }),
    ...(parsed.retrievedAt === undefined ? {} : { retrievedAt: parsed.retrievedAt }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const supplied = await supplier.supply(parsed.file);
  if (!supplied.ok) {
    reportIngestFailure(io, supplied.error);
    return 1;
  }

  const request: IngestRequest = {
    electionId: parsed.electionId,
    sourceId: parsed.sourceId,
    assignment:
      parsed.candidateId !== undefined
        ? { state: "ASSIGNED", candidateId: parsed.candidateId }
        : parsed.shared
          ? { state: "SHARED" }
          : { state: "UNASSIGNED" },
  };
  const store = createFileIngestStore({
    realDataRoot: storage.realDataRoot,
    ...(options.ingestOperations === undefined
      ? {}
      : { operations: options.ingestOperations }),
  });
  const outcome = await ingest(loaded.value, store, supplied.value, request);
  if (!outcome.ok) {
    reportIngestFailure(io, outcome.error);
    return 1;
  }

  const { record, status } = outcome.value;
  io.write(
    `Ingest ${status}: source=${record.sourceId} revision=${record.revision} election=${record.electionId} assignment=${record.assignment.state} sha256=${record.sha256} bytes=${record.byteLength}`,
  );
  return 0;
}

type ExtractArgs = Readonly<{ revision?: string; sourceId: string }>;

function parseExtractArgs(args: readonly string[]): ExtractArgs | undefined {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== "--source" && arg !== "--revision") {
      return undefined;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--") || values.has(arg)) {
      return undefined;
    }
    values.set(arg, value);
    index += 1;
  }

  const sourceId = values.get("--source");
  const revision = values.get("--revision");
  if (sourceId === undefined) {
    return undefined;
  }
  return { sourceId, ...(revision === undefined ? {} : { revision }) };
}

function reportExtractRejection(io: CliIo, code: string, message: string): void {
  io.write(`Extract rejected: ${code}`);
  io.write(message);
  io.write("Nothing was analyzed.");
}

async function extractDocument(
  args: readonly string[],
  options: CliOptions,
): Promise<number> {
  const { io } = options;
  const parsed = parseExtractArgs(args);
  if (parsed === undefined) {
    for (const line of USAGE_LINES) {
      io.write(line);
    }
    return 1;
  }

  const loaded = await readRegistryFile(registryOptions(options));
  if (!loaded.ok) {
    reportLoadError(io, loaded.error);
    return 1;
  }

  const storage = createStoragePathConfig(options.workspaceRoot);
  const listed = await createFileIngestStore({
    realDataRoot: storage.realDataRoot,
  }).listRecords(parsed.sourceId);
  if (!listed.ok) {
    reportExtractRejection(io, "STORE_READ_FAILED", "The ingest store could not be read safely.");
    return 1;
  }
  const record =
    parsed.revision === undefined
      ? listed.value.at(-1)
      : listed.value.find((candidate) => candidate.revision === parsed.revision);
  if (record === undefined) {
    reportExtractRejection(io, "RECORD_NOT_FOUND", "No ingest record matches that source and revision.");
    return 1;
  }
  const election = loaded.value.elections.find(
    (candidate) => candidate.electionId === record.electionId,
  );
  if (election === undefined) {
    reportExtractRejection(io, "UNKNOWN_ELECTION", "The election of this record is not registered.");
    return 1;
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(
      await readFile(
        join(storage.realDataRoot, "raw", ...record.rawSnapshotRelativePath.split("/")),
      ),
    );
  } catch {
    reportExtractRejection(io, "RAW_OBJECT_UNREADABLE", "The stored document could not be read.");
    return 1;
  }
  if (sha256Hex(bytes) !== record.sha256) {
    reportExtractRejection(io, "CHECKSUM_MISMATCH", "The stored document no longer matches its recorded SHA-256.");
    return 1;
  }

  const stored = await extractAndStore({
    bytes,
    candidates: election.candidates,
    extractor: options.extractor ?? createPdfjsTextExtractor(),
    extractorId: options.extractor === undefined ? PDFJS_EXTRACTOR_ID : INJECTED_EXTRACTOR_ID,
    now: options.now ?? (() => new Date()),
    revision: record.revision,
    sourceId: record.sourceId,
    sourceSha256: record.sha256,
    store: createFileStageStore({
      realDataRoot: storage.realDataRoot,
      ...(options.stageOperations === undefined ? {} : { operations: options.stageOperations }),
    }),
  });
  if (!stored.ok) {
    reportExtractRejection(io, stored.error.code, "The extraction could not be completed or saved safely.");
    return 1;
  }
  const { output } = stored.value;
  const stageLine = `Stage saved: stage=EXTRACT stageRunId=${stored.value.stageRunId.slice(0, 12)} cached=${stored.value.cached}`;
  const imagePages = output.imagePages.length === 0 ? "none" : output.imagePages.join(",");

  if (output.notReady !== null) {
    io.write(
      `Extract NOT_READY: source=${record.sourceId} revision=${record.revision} reason=${output.notReady} pages=${output.pageCount} imagePages=${imagePages}`,
    );
    io.write(stageLine);
    if (output.notReady === "ALL_PAGES_IMAGE") {
      io.write("OCR is not run automatically; human review is needed.");
    }
    return 1;
  }

  const assigned = output.passages.filter((passage) => passage.assignment.state === "ASSIGNED").length;
  io.write(
    `Extract COMPLETED: source=${record.sourceId} revision=${record.revision} pages=${output.pageCount} imagePages=${imagePages} passages=${output.passages.length} assigned=${assigned} unassigned=${output.passages.length - assigned}`,
  );
  io.write(stageLine);
  return 0;
}
/**
 * Runs one analysis CLI command and returns the process exit code: 0 on
 * success, 1 for a rejection, a failure or a usage error. It opens no port,
 * never prints document contents, and never calls Bedrock.
 */
export async function runAnalysisCli(
  argv: readonly string[],
  options: CliOptions,
): Promise<number> {
  const [group, action, target, ...extra] = argv;

  if (group === "election" && action === "show" && target === undefined) {
    return showElections(options);
  }

  if (
    group === "election" &&
    action === "change" &&
    target !== undefined &&
    extra.length === 0
  ) {
    return changeElection(target, options);
  }

  if (group === "extract") {
    return extractDocument(argv.slice(1), options);
  }

  if (group === "ocr") {
    const storage = createStoragePathConfig(options.workspaceRoot);
    const trace = createTracer({
      enabled: options.ocrTrace !== undefined,
      write: options.ocrTrace?.write ?? (() => undefined),
    });
    try {
      const code = await runOcrCommand(argv.slice(1), {
        createSession:
          options.createOcrSession ??
          ((settings, tracer) =>
            createPaddleOcrEngine({
              modelRoot: join(storage.realDataRoot, ...OCR_MODEL_RELATIVE_DIRECTORY.split("/")),
              strategy: settings.strategy,
              trace: tracer,
            })),
        io: options.io,
        rasterizer: options.rasterizer ?? createPdfjsPageRasterizer(),
        trace,
        workspaceRoot: options.workspaceRoot,
        ...(options.stageOperations === undefined ? {} : { operations: options.stageOperations }),
      });
      if (code !== undefined) {
        return code;
      }
    } finally {
      trace.stop();
    }
  }

  if (group === "inspect") {
    const parsed = parseInspectArgs(argv.slice(1));
    if (parsed !== undefined) {
      return inspectPdf(parsed, {
        extractor: options.extractor ?? createPdfjsTextExtractor(),
        io: options.io,
        workspaceRoot: options.workspaceRoot,
        ...(options.stageOperations === undefined ? {} : { operations: options.stageOperations }),
      });
    }
  }

  if (group === "ingest") {
    return ingestDocument(argv.slice(1), options);
  }

  for (const line of USAGE_LINES) {
    options.io.write(line);
  }
  return 1;
}