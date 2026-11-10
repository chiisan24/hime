import { StageRunKeySchema, type StageRun, type StageRunKey } from "@ehime-vote-navigator/contracts";
import type { Result } from "@ehime-vote-navigator/domain";
import { describe, expect, it } from "vitest";

import { computeInputHash, runStage, type RunStageRequest, type StageFailure } from "./stageRunner.js";
import { computeStageRunId, type StageStore } from "./stageStore.js";

const NOW = new Date("2026-11-05T09:00:00.000Z");

function makeKey(overrides: Record<string, unknown> = {}): StageRunKey {
  return StageRunKeySchema.parse({
    sourceSha256: "a".repeat(64),
    revision: "r1",
    stage: "CLASSIFY",
    modelId: "jp.anthropic.claude-haiku-5-5",
    inputHash: "b".repeat(64),
    ...overrides,
  });
}

type MemoryStore = StageStore & { failReads: boolean; failWrites: boolean; runs: StageRun[] };

function memoryStore(): MemoryStore {
  const store: MemoryStore = {
    failReads: false,
    failWrites: false,
    runs: [] as StageRun[],
    async findSucceeded(key: StageRunKey) {
      if (store.failReads) {
        return { ok: false as const, error: { code: "STORE_READ_FAILED" as const } };
      }
      const id = computeStageRunId(key);
      return {
        ok: true as const,
        value: store.runs.find((run) => run.status === "SUCCEEDED" && run.stageRunId === id) ?? null,
      };
    },
    async listRuns() {
      return { ok: true as const, value: [...store.runs] };
    },
    async saveRun(run: StageRun) {
      if (store.failWrites) {
        return { ok: false as const, error: { code: "STORE_WRITE_FAILED" as const } };
      }
      store.runs.push(run);
      return { ok: true as const, value: undefined };
    },
  };
  return store;
}

type Output = { theme: string };
function parseOutput(value: unknown): Output | undefined {
  return typeof value === "object" && value !== null && typeof (value as Output).theme === "string"
    ? { theme: (value as Output).theme }
    : undefined;
}

function request(
  execute: () => Promise<Result<Output, StageFailure>>,
  overrides: Partial<RunStageRequest<Output>> = {},
): RunStageRequest<Output> {
  return {
    execute,
    input: { passage: "p1" },
    key: makeKey(),
    parseOutput,
    passageId: "p1",
    runId: "run-1",
    scope: "PILOT",
    ...overrides,
  };
}

function counting(result: Result<Output, StageFailure>) {
  const state = { calls: 0 };
  return {
    state,
    execute: async () => {
      state.calls += 1;
      return result;
    },
  };
}

describe("computeStageRunId", () => {
  it("is the SHA-256 of the canonical key and does not depend on property order", () => {
    const key = makeKey();
    const shuffled = {
      inputHash: key.inputHash,
      stage: key.stage,
      sourceSha256: key.sourceSha256,
      revision: key.revision,
      modelId: key.modelId,
    } as StageRunKey;

    expect(computeStageRunId(key)).toMatch(/^[0-9a-f]{64}$/u);
    expect(computeStageRunId(shuffled)).toBe(computeStageRunId(key));
  });

  it.each([
    [{ sourceSha256: "c".repeat(64) }],
    [{ revision: "r2" }],
    [{ stage: "SUMMARISE" }],
    [{ modelId: null }],
    [{ inputHash: "d".repeat(64) }],
  ])("changes when the key element %j changes", (overrides) => {
    expect(computeStageRunId(makeKey(overrides))).not.toBe(computeStageRunId(makeKey()));
  });

  it("hashes a stage input in canonical JSON", () => {
    expect(computeInputHash({ b: 1, a: 2 })).toBe(computeInputHash({ a: 2, b: 1 }));
    expect(computeInputHash({ a: 1 })).not.toBe(computeInputHash({ a: 2 }));
    expect(() => computeInputHash({ a: 1n })).toThrow();
  });
});

describe("runStage", () => {
  it("executes once, stores the SUCCEEDED run and then serves it from the store", async () => {
    const store = memoryStore();
    const stage = counting({ ok: true, value: { theme: "教育" } });

    const first = await runStage({ now: () => NOW, store }, request(stage.execute));
    const second = await runStage({ now: () => NOW, store }, request(stage.execute));

    expect(first).toMatchObject({ ok: true, value: { cached: false, output: { theme: "教育" } } });
    expect(second).toMatchObject({ ok: true, value: { cached: true, output: { theme: "教育" } } });
    expect(stage.state.calls).toBe(1);
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({
      status: "SUCCEEDED",
      runId: "run-1",
      scope: "PILOT",
      passageId: "p1",
      errorClass: null,
      createdAt: "2026-11-05T09:00:00.000Z",
      input: { passage: "p1" },
    });
  });

  it.each([
    [{ sourceSha256: "c".repeat(64) }],
    [{ revision: "r2" }],
    [{ stage: "SUMMARISE" }],
    [{ modelId: "jp.anthropic.claude-opus-5-5" }],
    [{ inputHash: "d".repeat(64) }],
  ])("does not use a stored run when the key element %j differs", async (overrides) => {
    const store = memoryStore();
    const stage = counting({ ok: true, value: { theme: "経済" } });
    await runStage({ now: () => NOW, store }, request(stage.execute));

    const result = await runStage({ now: () => NOW, store }, request(stage.execute, { key: makeKey(overrides) }));

    expect(result).toMatchObject({ ok: true, value: { cached: false } });
    expect(stage.state.calls).toBe(2);
  });

  it("records a failure as a separate FAILED run that is never a cache hit", async () => {
    const store = memoryStore();
    const failing = counting({ ok: false, error: { code: "RESPONSE_INVALID" } });

    const first = await runStage({ now: () => NOW, store }, request(failing.execute));
    const second = await runStage({ now: () => NOW, store }, request(failing.execute));

    expect(first).toEqual({ ok: false, error: { code: "STAGE_FAILED", recorded: true, stageCode: "RESPONSE_INVALID" } });
    expect(second.ok).toBe(false);
    expect(failing.state.calls).toBe(2);
    expect(store.runs.map((run) => [run.status, run.errorClass, run.output])).toEqual([
      ["FAILED", "RESPONSE_INVALID", null],
      ["FAILED", "RESPONSE_INVALID", null],
    ]);
  });

  it("returns a stored SUCCEEDED run without executing, so a failing stage cannot overwrite it", async () => {
    const store = memoryStore();
    await runStage({ now: () => NOW, store }, request(counting({ ok: true, value: { theme: "防災" } }).execute));
    const failing = counting({ ok: false, error: { code: "RESPONSE_INVALID" } });

    const result = await runStage({ now: () => NOW, store }, request(failing.execute));

    expect(result).toMatchObject({ ok: true, value: { cached: true, output: { theme: "防災" } } });
    expect(failing.state.calls).toBe(0);
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]?.status).toBe("SUCCEEDED");
  });

  it("stores only a fixed error code, never a message", async () => {
    const store = memoryStore();
    const leaking = counting({ ok: false, error: { code: "secret prompt body: do not store" } });
    const throwing = async (): Promise<Result<Output, StageFailure>> => {
      throw new Error("secret response body");
    };

    const first = await runStage({ now: () => NOW, store }, request(leaking.execute));
    const second = await runStage({ now: () => NOW, store }, request(throwing));

    expect(first).toMatchObject({ error: { stageCode: "STAGE_ERROR" } });
    expect(second).toMatchObject({ error: { stageCode: "STAGE_EXCEPTION" } });
    expect(JSON.stringify(store.runs)).not.toContain("secret");
  });

  it("reports a write failure and does not keep an unsaved result", async () => {
    const store = memoryStore();
    store.failWrites = true;
    const stage = counting({ ok: true, value: { theme: "教育" } });

    const result = await runStage({ now: () => NOW, store }, request(stage.execute));
    store.failWrites = false;
    const retry = await runStage({ now: () => NOW, store }, request(stage.execute));

    expect(result).toEqual({ ok: false, error: { code: "STORE_WRITE_FAILED" } });
    expect(retry).toMatchObject({ ok: true, value: { cached: false } });
    expect(stage.state.calls).toBe(2);
  });

  it("records an output that fails validation as FAILED and stores no SUCCEEDED run", async () => {
    const store = memoryStore();
    const stage = counting({ ok: true, value: { theme: 3 } as unknown as Output });

    const result = await runStage({ now: () => NOW, store }, request(stage.execute));

    expect(result).toEqual({ ok: false, error: { code: "OUTPUT_INVALID" } });
    expect(store.runs.map((run) => [run.status, run.errorClass])).toEqual([["FAILED", "OUTPUT_INVALID"]]);
  });

  it("stops without executing when a stored output is no longer valid", async () => {
    const store = memoryStore();
    await runStage({ now: () => NOW, store }, request(counting({ ok: true, value: { theme: "教育" } }).execute));
    const stage = counting({ ok: true, value: { theme: "経済" } });

    const result = await runStage(
      { now: () => NOW, store },
      request(stage.execute, { parseOutput: () => undefined }),
    );

    expect(result).toEqual({ ok: false, error: { code: "CACHE_CORRUPT" } });
    expect(stage.state.calls).toBe(0);
  });

  it("stops without executing when the store cannot be read or the key is invalid", async () => {
    const store = memoryStore();
    store.failReads = true;
    const stage = counting({ ok: true, value: { theme: "教育" } });

    const unreadable = await runStage({ now: () => NOW, store }, request(stage.execute));
    const invalid = await runStage(
      { now: () => NOW, store: memoryStore() },
      request(stage.execute, { key: { ...makeKey(), revision: "x" } as unknown as StageRunKey }),
    );

    expect(unreadable).toEqual({ ok: false, error: { code: "STORE_READ_FAILED" } });
    expect(invalid).toEqual({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(stage.state.calls).toBe(0);
  });
});