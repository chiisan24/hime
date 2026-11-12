import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NO_TRACE, createTracer, type TraceClock } from "./trace.js";

function fakeClock(resources: readonly string[] = []) {
  const state = { cpu: 0, now: 0, rss: 100.4 };
  const clock: TraceClock = {
    activeResources: () => resources,
    cpuSeconds: () => state.cpu,
    now: () => state.now,
    rssMb: () => state.rss,
  };
  return { clock, state };
}

describe("createTracer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when tracing is off", async () => {
    const lines: string[] = [];
    const tracer = createTracer({ enabled: false, write: (line) => lines.push(line) });

    const value = await tracer.stage("render", async () => 7, { regions: 2 });
    tracer.event("crop", "region", { width: 1 });
    tracer.stop();
    vi.advanceTimersByTime(60_000);

    expect(value).toBe(7);
    expect(tracer).toBe(NO_TRACE);
    expect(lines).toEqual([]);
  });

  it("records the start, end, duration and memory of a step", async () => {
    const { clock, state } = fakeClock();
    const lines: string[] = [];
    const tracer = createTracer({ clock, enabled: true, write: (line) => lines.push(line) });

    const result = await tracer.stage(
      "render",
      async () => {
        state.now = 1234;
        state.rss = 250.6;
        return "done";
      },
      { dpi: 300, regions: 2 },
    );
    tracer.stop();

    expect(result).toBe("done");
    expect(lines).toEqual([
      "OCR_TRACE +0.000s render start rssMb=100 dpi=300 regions=2",
      "OCR_TRACE +1.234s render end rssMb=251 dpi=300 regions=2 ms=1234",
      "OCR_TRACE +1.234s run exit-check rssMb=251 resources=0",
    ]);
  });

  it("records a failing step and rethrows the error", async () => {
    const { clock, state } = fakeClock();
    const lines: string[] = [];
    const tracer = createTracer({ clock, enabled: true, write: (line) => lines.push(line) });

    await expect(
      tracer.stage("save", async () => {
        state.now = 20;
        throw new Error("secret message that must not be logged");
      }),
    ).rejects.toThrow("secret message");
    tracer.stop();

    expect(lines[1]).toBe("OCR_TRACE +0.020s save failed rssMb=100 ms=20");
    expect(lines.join("\n")).not.toContain("secret");
  });

  it("writes a heartbeat every few seconds with the CPU time and the active step", async () => {
    const { clock, state } = fakeClock();
    const lines: string[] = [];
    const tracer = createTracer({ clock, enabled: true, heartbeatMs: 5000, write: (line) => lines.push(line) });

    const running = tracer.stage("recognize", () => new Promise<void>((resolve) => setTimeout(resolve, 12_000)), { region: "A" });
    state.now = 5000;
    state.cpu = 4.96;
    await vi.advanceTimersByTimeAsync(5000);
    state.now = 10_000;
    state.cpu = 9.94;
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(2000);
    await running;
    tracer.stop();
    await vi.advanceTimersByTimeAsync(20_000);

    const beats = lines.filter((line) => line.includes(" heartbeat "));
    expect(beats).toEqual([
      "OCR_TRACE +5.000s heartbeat rssMb=100 cpuSec=5 active=recognize",
      "OCR_TRACE +10.000s heartbeat rssMb=100 cpuSec=9.9 active=recognize",
    ]);
  });

  it("reports the resources that keep the process alive when it stops", () => {
    const { clock } = fakeClock(["Timeout", "TTYWrap", "TTYWrap", "odd name!"]);
    const lines: string[] = [];
    const tracer = createTracer({ clock, enabled: true, write: (line) => lines.push(line) });

    tracer.stop();
    tracer.stop();

    expect(lines).toEqual(["OCR_TRACE +0.000s run exit-check rssMb=100 resources=4 res.Timeout=1 res.TTYWrap=2 res.other=1"]);
  });

  it("never prints a field that is not a short safe token or a number", () => {
    const { clock } = fakeClock();
    const lines: string[] = [];
    const tracer = createTracer({ clock, enabled: true, write: (line) => lines.push(line) });

    tracer.event("crop", "region", { region: "A-1", text: "本文を含む文字列", "bad key": 1, size: Number.NaN });
    tracer.stop();

    expect(lines[0]).toBe("OCR_TRACE +0.000s crop region rssMb=100 region=A-1 text=? size=NaN");
    expect(lines.join("\n")).not.toContain("本文");
  });
});