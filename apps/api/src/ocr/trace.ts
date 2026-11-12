/** The steps of an OCR run that can be traced. */
export const TRACE_STAGES = [
  "pdf-read",
  "render",
  "crop",
  "model-load",
  "detect",
  "recognize",
  "save",
  "release",
  "run",
] as const;
export type TraceStage = (typeof TRACE_STAGES)[number];

/** Numbers and short safe tokens only, so a trace line cannot carry page text. */
export type TraceFields = Readonly<Record<string, number | string>>;

export type TraceClock = Readonly<{
  activeResources: () => readonly string[];
  cpuSeconds: () => number;
  now: () => number;
  rssMb: () => number;
}>;

export type TracerOptions = Readonly<{
  clock?: TraceClock;
  enabled: boolean;
  heartbeatMs?: number;
  write: (line: string) => void;
}>;

export type Tracer = Readonly<{
  enabled: boolean;
  /** Records one measured fact, for example the size of a rendered region. */
  event: (stage: TraceStage, name: string, fields?: TraceFields) => void;
  /** Runs a step and records its start, end, duration and memory. */
  stage: <T>(stage: TraceStage, run: () => Promise<T>, fields?: TraceFields) => Promise<T>;
  /** Stops the heartbeat and records which resources still keep the process alive. */
  stop: () => void;
}>;

export const DEFAULT_HEARTBEAT_MS = 5000;
const SAFE_TOKEN = /^[A-Za-z0-9._:-]{1,40}$/u;

const SYSTEM_CLOCK: TraceClock = {
  activeResources: () => process.getActiveResourcesInfo(),
  cpuSeconds: () => {
    const usage = process.cpuUsage();
    return (usage.user + usage.system) / 1_000_000;
  },
  now: () => performance.now(),
  rssMb: () => process.memoryUsage().rss / 1_048_576,
};

/** A tracer that does nothing; used when tracing is off. */
export const NO_TRACE: Tracer = Object.freeze({
  enabled: false,
  event: () => undefined,
  stage: <T>(_stage: TraceStage, run: () => Promise<T>) => run(),
  stop: () => undefined,
});

function renderValue(value: number | string): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "NaN";
  }
  return SAFE_TOKEN.test(value) ? value : "?";
}

function renderFields(fields: TraceFields | undefined): string {
  if (fields === undefined) {
    return "";
  }
  return Object.entries(fields)
    .filter(([key]) => SAFE_TOKEN.test(key))
    .map(([key, value]) => ` ${key}=${renderValue(value)}`)
    .join("");
}

/**
 * Writes one line per event: `OCR_TRACE +<seconds>s <step> <event> rssMb=<n> ...`.
 * Lines carry step names, durations, memory and counts only. A heartbeat every
 * few seconds shows whether the process is still running and how much CPU time
 * it has used; a heartbeat that stops arriving means the event loop is blocked
 * by synchronous work.
 */
export function createTracer(options: TracerOptions): Tracer {
  if (!options.enabled) {
    return NO_TRACE;
  }

  const clock = options.clock ?? SYSTEM_CLOCK;
  const startedAt = clock.now();
  const active: TraceStage[] = [];
  let stopped = false;

  const prefix = (): string => `OCR_TRACE +${((clock.now() - startedAt) / 1000).toFixed(3)}s`;
  const line = (stage: string, name: string, fields?: TraceFields): string =>
    `${prefix()} ${stage} ${renderValue(name)} rssMb=${Math.round(clock.rssMb())}${renderFields(fields)}`;

  const timer = setInterval(() => {
    options.write(
      `${prefix()} heartbeat rssMb=${Math.round(clock.rssMb())} cpuSec=${Math.round(clock.cpuSeconds() * 10) / 10} active=${active.at(-1) ?? "none"}`,
    );
  }, options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
  timer.unref();

  return {
    enabled: true,
    event: (stage, name, fields) => {
      options.write(line(stage, name, fields));
    },
    stage: async (stage, run, fields) => {
      const started = clock.now();
      active.push(stage);
      options.write(line(stage, "start", fields));
      try {
        const value = await run();
        options.write(line(stage, "end", { ...fields, ms: Math.round(clock.now() - started) }));
        return value;
      } catch (error) {
        options.write(line(stage, "failed", { ...fields, ms: Math.round(clock.now() - started) }));
        throw error;
      } finally {
        active.pop();
      }
    },
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(timer);

      const counts = new Map<string, number>();
      for (const name of clock.activeResources()) {
        const safe = SAFE_TOKEN.test(name) ? name : "other";
        counts.set(safe, (counts.get(safe) ?? 0) + 1);
      }
      const fields: Record<string, number> = { resources: [...counts.values()].reduce((sum, count) => sum + count, 0) };
      for (const [name, count] of counts) {
        fields[`res.${name}`] = count;
      }
      options.write(line("run", "exit-check", fields));
    },
  };
}