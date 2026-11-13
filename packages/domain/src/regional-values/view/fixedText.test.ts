import type { FixedTextKey } from "@ehime-vote-navigator/contracts";
import { requiredFixedTextKeys } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { syntheticFixedTexts, syntheticText } from "../../../../../tests/harness/regional-values/testFixedTexts.js";
import type { SessionBundle } from "../session/sessionTypes.js";
import { lookupFixedText, missingFixedTextKeys, renderFixedText } from "./fixedText.js";
import type { ViewBundle } from "./viewTypes.js";

const fixture = { fixedTexts: syntheticFixedTexts("FIXTURE") };

function withText(key: FixedTextKey, text: string): { fixedTexts: ReturnType<typeof syntheticFixedTexts> } {
  return { fixedTexts: syntheticFixedTexts("FIXTURE", { texts: { [key]: text } }) };
}

describe("lookupFixedText", () => {
  it("returns the approved text of a key, placeholders unfilled", () => {
    expect(lookupFixedText(fixture, "error.UNEXPECTED")).toBe("〈error.UNEXPECTED〉");
    expect(lookupFixedText(fixture, "counts.themes")).toBe("〈counts.themes〉{n}{m}");
  });

  it("throws for a key the bundle does not hold, naming the key", () => {
    const bundle = { fixedTexts: syntheticFixedTexts("FIXTURE", { omit: ["error.UNEXPECTED"] }) };
    expect(() => lookupFixedText(bundle, "error.UNEXPECTED")).toThrow("error.UNEXPECTED");
  });

  it("reaches every required key of both data kinds", () => {
    for (const dataKind of ["FIXTURE", "REAL_AI"] as const) {
      const bundle = { fixedTexts: syntheticFixedTexts(dataKind) };
      for (const key of requiredFixedTextKeys(dataKind)) {
        expect(lookupFixedText(bundle, key)).toBe(syntheticText(key));
      }
    }
  });
});

describe("renderFixedText", () => {
  it("fills in the names that the key allows", () => {
    expect(renderFixedText(fixture, "counts.themes", { n: 3, m: 6 })).toBe("〈counts.themes〉36");
    expect(renderFixedText(withText("about.thresholds", "{t1}と{t2}"), "about.thresholds", { t1: 50, t2: 150 })).toBe(
      "50と150",
    );
  });

  it("returns a text without placeholders as it is, and takes no values", () => {
    expect(renderFixedText(fixture, "action.RESTART")).toBe("〈action.RESTART〉");
  });

  it("rejects a placeholder without a value (missing)", () => {
    expect(() => renderFixedText(fixture, "counts.themes", { n: 3 })).toThrow("needs the value m");
    expect(() => renderFixedText(fixture, "counts.themes")).toThrow("needs the value n");
  });

  it("rejects a value for a name the key does not allow (extra)", () => {
    expect(() => renderFixedText(fixture, "counts.themes", { n: 1, m: 2, t1: 3 })).toThrow("does not take the value t1");
    expect(() => renderFixedText(fixture, "action.RESTART", { n: 1 })).toThrow("does not take the value n");
  });

  it("rejects a number that is not an integer", () => {
    expect(() => renderFixedText(fixture, "counts.themes", { n: 1.5, m: 2 })).toThrow(RangeError);
    expect(() => renderFixedText(fixture, "counts.themes", { n: Number.NaN, m: 2 })).toThrow(RangeError);
  });

  it("fills a value in once and does not read it as a placeholder", () => {
    const bundle = withText("note.noThemeDifference", "{themeName}です");
    expect(renderFixedText(bundle, "note.noThemeDifference", { themeName: "{themeName}" })).toBe("{themeName}です");
  });

  it("throws for a key the bundle does not hold", () => {
    const bundle = { fixedTexts: syntheticFixedTexts("FIXTURE", { omit: ["counts.themes"] }) };
    expect(() => renderFixedText(bundle, "counts.themes", { n: 1, m: 2 })).toThrow("counts.themes");
  });
});

describe("missingFixedTextKeys", () => {
  it("finds nothing in a complete set of either data kind", () => {
    expect(missingFixedTextKeys("FIXTURE", syntheticFixedTexts("FIXTURE"))).toEqual([]);
    expect(missingFixedTextKeys("REAL_AI", syntheticFixedTexts("REAL_AI"))).toEqual([]);
  });

  it("finds the omitted keys in the order of the closed list", () => {
    const texts = syntheticFixedTexts("FIXTURE", { omit: ["ui.next", "error.UNEXPECTED", "notice"] });
    expect(missingFixedTextKeys("FIXTURE", texts)).toEqual(["notice", "error.UNEXPECTED", "ui.next"]);
  });

  it("finds the license texts that a REAL_AI bundle lacks, and not for FIXTURE", () => {
    const texts = syntheticFixedTexts("REAL_AI", { omit: ["license.ccby.license"] });
    expect(missingFixedTextKeys("REAL_AI", texts)).toEqual(["license.ccby.license"]);
    expect(missingFixedTextKeys("FIXTURE", syntheticFixedTexts("FIXTURE"))).not.toContain("license.ccby.license");
  });
});

describe("ViewBundle", () => {
  it("satisfies the SessionBundle of the state machine structurally", () => {
    const asSession = (bundle: ViewBundle): SessionBundle => bundle;
    expect(typeof asSession).toBe("function");
  });
});