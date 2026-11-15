import { join, resolve } from "node:path";

import type { DataKind } from "@ehime-vote-navigator/contracts";

import type { AtomicFileOperationOverrides } from "../store/atomicFiles.js";
import { loadBuildConfig, loadNeutralityConfig } from "./build/loadConfig.js";
import type { RegionalValuesCliIo } from "./cli.js";
import { defaultRecordRoot } from "./draft/types.js";
import type { RecordRoot } from "./draft/types.js";
import { parseArgs } from "./draftCli.js";
import { createIntakeStore } from "./intake/storeLayout.js";
import { verifyFact } from "./intake/verifyFact.js";

/**
 * `verify-fact <factId> --verifier <id>` (`npm run regional-values -- verify-fact ...`, 13.11): a person
 * checks a fact item against the value that is computed again from its original, and only on two explicit
 * yes is the fact item written back as `VERIFIED`, with the person and the time.
 *
 * Like the other commands, it opens no port, calls no AI, and prints no row of an original: it prints what the
 * person needs to compare (the stored value, the value computed again, the place in the original, the
 * number of blank cells and of rows that were left out, the sentence of the fact item), and fixed codes. There
 * is no option that answers for the person: without a way to ask (`io.confirm`), nothing is written.
 */

export type VerifyFactCommandSeams = Readonly<{
  /** The directory of the records of real data. A test gives a temporary directory. */
  recordRoot?: (dataKind: DataKind) => RecordRoot;
  /** The directory of the originals (`data/real/raw/regional-values`). The default is next to the records. */
  rawRoot?: string;
  /** The seam for the faults of the file system, in a test. */
  operations?: AtomicFileOperationOverrides;
}>;

export type VerifyFactCommandOptions = Readonly<{
  io: RegionalValuesCliIo;
  workspaceRoot: string;
  now?: () => Date;
  verifyFact?: VerifyFactCommandSeams;
}>;

export const VERIFY_FACT_USAGE_LINES: readonly string[] = [
  "Usage: npm run regional-values -- verify-fact <factId> --verifier <id> [--config-dir <path>]",
  "  shows the stored value and the value computed again from the original, and asks; only two answers of y make the fact item VERIFIED",
];

function argumentInvalid(io: RegionalValuesCliIo): number {
  for (const line of VERIFY_FACT_USAGE_LINES) {
    io.write(line);
  }
  io.write("code=ARGUMENT_INVALID");
  return 1;
}

/** Runs `verify-fact`. Returns 0 when the fact item is verified now, or was verified and still counts as verified; 1 for anything else. */
export async function runVerifyFactCommand(argv: readonly string[], options: VerifyFactCommandOptions): Promise<number> {
  const { io } = options;
  const [, ...args] = argv;
  const parsed = parseArgs(args, ["--verifier", "--config-dir"], []);
  const factId = parsed?.positionals[0];
  const verifierId = parsed?.values.get("--verifier");
  if (parsed === null || parsed.positionals.length !== 1 || factId === undefined || verifierId === undefined) {
    return argumentInvalid(io);
  }

  // The lists of words that the check of a sentence reads come from the settings of the build.
  const configDir = resolve(options.workspaceRoot, parsed.values.get("--config-dir") ?? join("config", "regional-values"));
  const build = await loadBuildConfig(configDir);
  const neutrality = await loadNeutralityConfig(configDir);
  if (!build.ok || !neutrality.ok) {
    io.write("code=CONFIG_UNREADABLE");
    return 1;
  }

  const seams = options.verifyFact ?? {};
  const root = seams.recordRoot?.("REAL_AI") ?? defaultRecordRoot(options.workspaceRoot, "REAL_AI");
  const store = createIntakeStore(root, {
    ...(seams.rawRoot === undefined ? {} : { rawRoot: seams.rawRoot }),
    ...(seams.operations === undefined ? {} : { operations: seams.operations }),
  });
  const confirm = io.confirm;

  const outcome = await verifyFact(
    store,
    { factId, verifierId },
    {
      now: options.now ?? ((): Date => new Date()),
      // Without a way to ask, the answer is no.
      confirm: confirm === undefined ? () => Promise.resolve(false) : confirm,
      write: io.write,
      lists: { properNouns: build.value.properNouns, numeralExemptWords: neutrality.value.numeralExemptWords },
    },
  );

  if (outcome.ok) {
    if (outcome.value.status === "VERIFIED") {
      io.write(`code=VERIFY_OK factId=${outcome.value.fact.factId}`);
      return 0;
    }
    for (const finding of outcome.value.findings) {
      io.write(`finding=${finding}`);
    }
    for (const problem of outcome.value.problems) {
      io.write(`problem=${problem}`);
    }
    io.write(`code=VERIFY_NOT_NEEDED status=ALREADY_VERIFIED effective=${outcome.value.effective}`);
    return outcome.value.effective === "VERIFIED" ? 0 : 1;
  }

  const { error } = outcome;
  for (const finding of error.findings ?? []) {
    io.write(`finding=${finding}`);
  }
  for (const problem of error.problems ?? []) {
    io.write(`problem=${problem}`);
  }
  io.write(`code=VERIFY_FAILED reason=${error.code}${error.reason === undefined ? "" : ` cause=${error.reason}`}`);
  return 1;
}
