import { describe, expect, it } from "vitest";

import { FakeClock, FakeIdSource } from "./deterministic-sources.js";

describe("FakeClock", () => {
  it("returns snapshots and advances only when directed", () => {
    const clock = new FakeClock("2022-11-20T00:00:00.000Z");
    const firstSnapshot = clock.now();

    clock.advanceBy(1_500);

    expect(firstSnapshot.toISOString()).toBe("2022-11-20T00:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2022-11-20T00:00:01.500Z");

    clock.set("2026-11-15T15:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-11-15T15:00:00.000Z");
  });

  it("rejects invalid instants and negative advances", () => {
    expect(() => new FakeClock("not-an-instant")).toThrow(/valid instant/);

    const clock = new FakeClock(0);
    expect(() => clock.advanceBy(-1)).toThrow(/non-negative/);
  });
});

describe("FakeIdSource", () => {
  it("replays the same sequence from the same seed", () => {
    const first = new FakeIdSource("run", 41);
    const second = new FakeIdSource("run", 41);

    expect([first.nextId(), first.nextId()]).toEqual([
      "run-000041",
      "run-000042",
    ]);
    expect([second.nextId(), second.nextId()]).toEqual([
      "run-000041",
      "run-000042",
    ]);
  });

  it("rejects invalid prefixes and seeds", () => {
    expect(() => new FakeIdSource("", 0)).toThrow(/prefix/);
    expect(() => new FakeIdSource("run", -1)).toThrow(/seed/);
  });
});
