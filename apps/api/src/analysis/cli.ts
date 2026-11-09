import {
  applyElectionChange,
  readRegistryFile,
  type RegistryFileOptions,
  type RegistryLoadError,
} from "../election/registryFile.js";

/** Terminal boundary of the analysis CLI; tests replace it with a fake. */
export type CliIo = Readonly<{
  /** Asks a yes/no question. Anything but an explicit yes must resolve false. */
  confirm: (question: string) => Promise<boolean>;
  write: (line: string) => void;
}>;

export type CliOptions = Readonly<{
  io: CliIo;
  /** Test seams for the registry file; the real filesystem is the default. */
  registry?: Pick<RegistryFileOptions, "operations" | "readFile">;
  workspaceRoot: string;
}>;

const USAGE_LINES: readonly string[] = [
  "Usage: npm run analysis -- <command>",
  "  election show                   List the registered elections",
  "  election change <electionId>    Change the current election after approval",
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

/**
 * Runs one analysis CLI command and returns the process exit code: 0 on
 * success, 1 for a rejection, a failure or a usage error. It opens no port.
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

  for (const line of USAGE_LINES) {
    options.io.write(line);
  }
  return 1;
}