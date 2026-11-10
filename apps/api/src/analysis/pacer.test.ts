import { describe, expect, it } from "vitest";

import { MIN_REQUEST_INTERVAL_MS, createPacer, type PacerClock } from "./pacer.js";

function fakeClock(start = 1_000_000) {
  const state = { time: start, sleeps: [] as number[], failNextSleep: false };
  const clock: PacerClock = {
    now: () => state.time,
    sleep: async (milliseconds) => {
      state.sleeps.push(milliseconds);
      if (state.failNextSleep) {
        state.failNextSleep = false;
        throw new Error("sleep failed");
      }
      state.time += milliseconds;
    },
  };
  return { clock, state };
}

describe("createPacer", () => {
  it("lets the first request start at once", async () => {
    const { clock, state } = fakeClock();

    await createPacer({ clock }).wait();

    expect(state.sleeps).toEqual([]);
  });

  it("waits the full interval when the next request comes right away", async () => {
    const { clock, state } = fakeClock();
    const pacer = createPacer({ clock });

    await pacer.wait();
    await pacer.wait();

    expect(state.sleeps).toEqual([6100]);
  });

  it("waits only for the time that is left, and not at all after the interval", async () => {
    const { clock, state } = fakeClock();
    const pacer = createPacer({ clock });

    await pacer.wait();
    state.time += 2000;
    await pacer.wait();
    state.time += 7000;
    await pacer.wait();

    expect(state.sleeps).toEqual([4100]);
  });

  it("serves concurrent callers one at a time, 6.1 seconds apart", async () => {
    const { clock } = fakeClock();
    const pacer = createPacer({ clock });
    const starts: number[] = [];

    await Promise.all([1, 2, 3].map(() => pacer.wait().then(() => starts.push(clock.now()))));

    expect(starts).toEqual([1_000_000, 1_006_100, 1_012_200]);
  });

  it("does not block later callers when one wait fails", async () => {
    const { clock, state } = fakeClock();
    const pacer = createPacer({ clock });
    await pacer.wait();
    state.failNextSleep = true;

    await expect(pacer.wait()).rejects.toThrow("sleep failed");
    await expect(pacer.wait()).resolves.toBeUndefined();
  });

  it("refuses an interval below 6.1 seconds", () => {
    expect(MIN_REQUEST_INTERVAL_MS).toBe(6100);
    expect(() => createPacer({ minIntervalMs: 6099 })).toThrow(RangeError);
    expect(() => createPacer({ minIntervalMs: Number.NaN })).toThrow(RangeError);
    expect(() => createPacer({ minIntervalMs: 6100 })).not.toThrow();
  });
});