/** The time source of a Pacer; tests replace it with a fake clock. */
export type PacerClock = Readonly<{
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}>;

export type Pacer = Readonly<{
  /** Resolves when the next request may start. Calls are served one at a time, in order. */
  wait: () => Promise<void>;
}>;

export type PacerOptions = Readonly<{
  clock?: PacerClock;
  minIntervalMs?: number;
}>;

/** Keeps requests below 10 per minute: one start every 6.1 seconds at the earliest. */
export const MIN_REQUEST_INTERVAL_MS = 6100;

const SYSTEM_CLOCK: PacerClock = {
  now: () => Date.now(),
  sleep: (milliseconds) =>
    new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }),
};

/**
 * Spaces request starts at least `minIntervalMs` apart. The first request starts
 * at once. The interval cannot be set below 6.1 seconds.
 */
export function createPacer(options: PacerOptions = {}): Pacer {
  const minIntervalMs = options.minIntervalMs ?? MIN_REQUEST_INTERVAL_MS;
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < MIN_REQUEST_INTERVAL_MS) {
    throw new RangeError("The request interval must be at least 6.1 seconds");
  }

  const clock = options.clock ?? SYSTEM_CLOCK;
  let lastStart: number | undefined;
  let tail: Promise<void> = Promise.resolve();

  return {
    wait() {
      const turn = tail.then(async () => {
        if (lastStart !== undefined) {
          const remaining = lastStart + minIntervalMs - clock.now();
          if (remaining > 0) {
            await clock.sleep(remaining);
          }
        }
        lastStart = clock.now();
      });
      tail = turn.catch(() => undefined);
      return turn;
    },
  };
}