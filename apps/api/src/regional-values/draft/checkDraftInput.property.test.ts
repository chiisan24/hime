import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  REAL_SHA_A,
  TEST_LIMITS,
  createClock,
  createFakeClient,
  createTempRoot,
  createTestDeps,
  fixtureFact,
  realFact,
  realSource,
  summaryRequest,
} from "../../../../../tests/harness/regional-values/draftSupport.js";
import { checkDraftInput, DRAFT_INPUT_REASONS } from "./checkDraftInput.js";
import type { DraftInputContext, DraftInputMaterial } from "./checkDraftInput.js";
import { DATA_CLOSE, DATA_OPEN } from "./prompts/delimiters.js";
import { runDraft } from "./runDraft.js";

const RUNS = 200;

type Spec = Readonly<{
  dataKind: "REAL_AI" | "FIXTURE";
  usage: "CONFIRMED" | "UNKNOWN" | "RESTRICTED";
  transmission: "UNKNOWN" | "ALLOWED" | "DENIED";
  verified: boolean;
  bulletin: boolean;
  delimiter: "NONE" | "OPEN" | "CLOSE";
  extraFacts: number;
  unit: "a" | "あ" | "😀";
  systemUnits: number;
  textUnits: number;
}>;

const specArbitrary: fc.Arbitrary<Spec> = fc.record({
  dataKind: fc.constantFrom("REAL_AI", "FIXTURE"),
  usage: fc.constantFrom("CONFIRMED", "UNKNOWN", "RESTRICTED"),
  transmission: fc.constantFrom("UNKNOWN", "ALLOWED", "DENIED"),
  verified: fc.boolean(),
  bulletin: fc.boolean(),
  delimiter: fc.constantFrom("NONE", "OPEN", "CLOSE"),
  extraFacts: fc.integer({ min: 0, max: TEST_LIMITS.maxEvidenceUnits + 2 }),
  unit: fc.constantFrom("a", "あ", "😀"),
  // The lengths are around the limit, so that the boundary is reached often.
  systemUnits: fc.integer({ min: 0, max: 20_000 }),
  textUnits: fc.oneof(fc.integer({ min: 0, max: 20_100 }), fc.integer({ min: 9_900, max: 10_100 })),
});

const DENIED = { status: "DENIED", checkedBy: "tester-1", checkedAt: "2026-01-02T00:00:00Z", evidence: "送信を認めない" } as const;

function materialOf(spec: Spec): { input: DraftInputMaterial; context: DraftInputContext } {
  const system = "x".repeat(spec.systemUnits);
  const text = spec.unit.repeat(Math.max(0, Math.floor(spec.textUnits / spec.unit.length)));
  const real = spec.dataKind === "REAL_AI";
  const facts = Array.from({ length: 1 + spec.extraFacts }, (_, index) =>
    real
      ? realFact(`real-${index}`, spec.verified ? {} : { verification: { status: "PROVISIONAL" } })
      : fixtureFact(`fx-${index}`),
  );
  const sources = real
    ? [
        realSource({
          usage: { status: spec.usage, checkedAt: "2026-01-02", checkedTarget: "利用条件", evidence: "確認" },
          transmission: spec.transmission === "ALLOWED" ? realSource().transmission : spec.transmission === "DENIED" ? DENIED : { status: "UNKNOWN" },
        }),
      ]
    : [];
  const piece = spec.delimiter === "OPEN" ? `a${DATA_OPEN}` : spec.delimiter === "CLOSE" ? `${DATA_CLOSE}a` : "plain";
  return {
    input: {
      task: "ISSUE_CANDIDATE",
      dataKind: spec.dataKind,
      system,
      text,
      materials: [piece],
      facts,
      evidence: [],
      sources,
      factRegistry: facts,
    },
    context: { limits: TEST_LIMITS, bulletinSha256s: spec.bulletin && real ? new Set([REAL_SHA_A]) : new Set() },
  };
}

/** The judgment written again, from the rules of the table of the design, not from the code. */
function referenceReasons(spec: Spec, text: string, system: string): readonly string[] {
  const found = new Set<string>();
  const real = spec.dataKind === "REAL_AI";
  if (real && spec.bulletin) {
    found.add("INPUT_IS_ELECTION_BULLETIN");
  }
  if (real && !spec.verified) {
    found.add("FACT_NOT_VERIFIED");
  }
  if (real && spec.usage !== "CONFIRMED") {
    found.add("USAGE_NOT_CONFIRMED");
  }
  if (real && spec.transmission !== "ALLOWED") {
    found.add("TRANSMISSION_NOT_ALLOWED");
  }
  if (1 + spec.extraFacts > TEST_LIMITS.maxEvidenceUnits) {
    found.add("INPUT_TOO_MANY_UNITS");
  }
  if (spec.delimiter !== "NONE") {
    found.add("INPUT_CONTAINS_DELIMITER");
  }
  // UTF-16 code units: the bytes of the text in UTF-16 divided by 2.
  if ((Buffer.byteLength(system, "utf16le") + Buffer.byteLength(text, "utf16le")) / 2 > 20_000) {
    found.add("INPUT_TOO_LONG");
  }
  return DRAFT_INPUT_REASONS.filter((reason) => found.has(reason));
}

describe("Property 28: the gate of the input", () => {
  /** **Validates: Requirements 7.12, 7.19, 8.5, 8.6, 8.7, 12.5, 12.14** */
  it("agrees with the reference judgment for any kind, terms of use, sending, verification, length and delimiter", () => {
    fc.assert(
      fc.property(specArbitrary, (spec) => {
        const { input, context } = materialOf(spec);
        const result = checkDraftInput(input, context);
        const expected = referenceReasons(spec, input.text, input.system);
        if (expected.length === 0) {
          expect(result).toEqual({ ok: true });
        } else {
          expect(result).toEqual({ ok: false, reasons: expected });
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("does not require the terms of use or the sending for fictional data, whatever they would be", () => {
    fc.assert(
      fc.property(specArbitrary, (spec) => {
        const { input, context } = materialOf({ ...spec, dataKind: "FIXTURE", delimiter: "NONE", extraFacts: 0, bulletin: false, systemUnits: 10, textUnits: 10 });
        expect(checkDraftInput(input, context)).toEqual({ ok: true });
      }),
      { numRuns: RUNS },
    );
  });

  it("accepts a total of 20,000 code units and refuses 20,001, whatever the characters are", () => {
    fc.assert(
      fc.property(fc.constantFrom("a", "あ", "😀"), fc.integer({ min: 0, max: 20_000 }), (unit, systemUnits) => {
        const rest = 20_000 - systemUnits;
        const text = unit.repeat(Math.floor(rest / unit.length));
        const exact = text.length === rest;
        const base = materialOf({
          dataKind: "FIXTURE",
          usage: "CONFIRMED",
          transmission: "ALLOWED",
          verified: true,
          bulletin: false,
          delimiter: "NONE",
          extraFacts: 0,
          unit: "a",
          systemUnits,
          textUnits: 0,
        });
        const at = { ...base.input, text };
        expect(checkDraftInput(at, base.context)).toEqual({ ok: true });
        if (exact) {
          expect(checkDraftInput({ ...at, text: `${text}a` }, base.context)).toEqual({ ok: false, reasons: ["INPUT_TOO_LONG"] });
        }
      }),
      { numRuns: RUNS },
    );
  });
});

describe("Property 28 (the whole run): an input that is refused makes no call and saves nothing", () => {
  it("never calls the model and never writes a file when the gate refuses the input", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Spec["usage"]>("CONFIRMED", "UNKNOWN", "RESTRICTED"),
        fc.constantFrom<Spec["transmission"]>("UNKNOWN", "DENIED", "ALLOWED"),
        fc.boolean(),
        async (usage, transmission, verified) => {
          // At least one of the three conditions is not met.
          fc.pre(usage !== "CONFIRMED" || transmission !== "ALLOWED" || !verified);
          const temp = await createTempRoot("REAL_AI");
          try {
            const fake = createFakeClient(["{}"]);
            const { deps } = createTestDeps(temp.root, fake.client, { now: createClock() });
            const request = {
              ...summaryRequest(),
              dataKind: "REAL_AI" as const,
              facts: [realFact("real-1", verified ? {} : { verification: { status: "PROVISIONAL" } })],
              evidence: [],
              sources: [
                realSource({
                  usage: { status: usage, checkedAt: "2026-01-02", checkedTarget: "利用条件", evidence: "確認" },
                  transmission: transmission === "ALLOWED" ? realSource().transmission : transmission === "DENIED" ? DENIED : { status: "UNKNOWN" },
                }),
              ],
              task: "ISSUE_CANDIDATE" as const,
            };
            const outcome = await runDraft(deps, request);
            expect(outcome.ok).toBe(false);
            expect(fake.calls).toHaveLength(0);
            expect(await deps.store.loadDrafts()).toEqual({ ok: true, value: [] });
            expect(await deps.store.loadEvents()).toEqual({ ok: true, value: [] });
          } finally {
            await temp.remove();
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});
