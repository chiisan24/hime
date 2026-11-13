import type { MapError } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { syntheticFixedTexts } from "../../../../../tests/harness/regional-values/testFixedTexts.js";
import { QUICK_VIEW_BUNDLE } from "../../../../../tests/harness/regional-values/testViewBundle.js";
import { ANSWERS_V15, viewOf } from "../../../../../tests/harness/regional-values/viewDriver.js";
import { buildResultViewModel } from "./buildResultViewModel.js";
import { RELOAD_GUIDE_TEXT, buildErrorView, buildUnexpectedErrorView } from "./errorView.js";
import type { ViewBundle } from "./viewTypes.js";

const bundle = QUICK_VIEW_BUNDLE;

const ERRORS: readonly (readonly [MapError, readonly string[]])[] = [
  [{ code: "NO_OPINION_ANSWERS" }, ["REVIEW_ANSWERS"]],
  [{ code: "UNKNOWN_QUESTION", questionIds: ["secret-q"] }, ["RESTART"]],
  [{ code: "INVALID_ANSWER", questionIds: ["secret-q"] }, ["RESTART"]],
  [{ code: "INVALID_CONFIG" }, []],
];

describe("buildErrorView", () => {
  it.each(ERRORS)("%j shows its fixed text and only the way out that fits", (error, actionCodes) => {
    const view = buildErrorView(bundle, error);
    expect(view.kind).toBe("ERROR");
    expect(view.code).toBe(error.code);
    expect(view.message).toBe(`〈error.${error.code}〉`);
    expect(view.actions.map((action) => action.code)).toEqual(actionCodes);
    expect(view.actions.map((action) => action.text)).toEqual(actionCodes.map((code) => `〈action.${code}〉`));
  });

  it.each(ERRORS)("%j holds no theme, level, class, count or offending question ID", (error) => {
    const view = buildErrorView(bundle, error);
    expect(Object.keys(view).sort()).toEqual(["actions", "code", "frame", "kind", "message"]);
    expect(JSON.stringify(view)).not.toContain("secret-q");
  });

  it("shows no way out for INVALID_CONFIG (neither review nor restart)", () => {
    expect(buildErrorView(bundle, { code: "INVALID_CONFIG" }).actions).toEqual([]);
  });

  it("keeps the banner and the way to the About screen on the error screen", () => {
    const view = buildErrorView(bundle, { code: "NO_OPINION_ANSWERS" });
    expect(view.frame.banner).toEqual({ code: "BANNER", text: "〈banner.FIXTURE〉" });
    expect(view.frame.aboutLink).toEqual({ code: "ABOUT", text: "〈ui.about〉" });
  });

  it("uses the banner of the real-data kind for a REAL_AI bundle", () => {
    const real: ViewBundle = { ...bundle, meta: { dataKind: "REAL_AI" }, fixedTexts: syntheticFixedTexts("REAL_AI") };
    expect(buildErrorView(real, { code: "INVALID_CONFIG" }).frame.banner.text).toBe("〈banner.REAL_AI〉");
  });
});

describe("buildResultViewModel on an error of the map generation", () => {
  it("returns the error view and never the answers", () => {
    const view = buildResultViewModel({
      bundle,
      setKind: "QUICK",
      answers: ANSWERS_V15,
      current: { ok: false, error: { code: "INVALID_ANSWER", questionIds: ["q-ed-imp"] } },
      previous: null,
      focusThemeId: null,
    });
    expect(view.kind).toBe("ERROR");
    const text = JSON.stringify(view);
    for (const leaked of ["q-ed-imp", "NOT_VERY_IMPORTANT", "防災", "教育・子育て"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("returns NO_OPINION_ANSWERS for a diagnosis without any answer", () => {
    const view = viewOf(bundle, "QUICK", {});
    expect(view.kind === "ERROR" ? view.code : null).toBe("NO_OPINION_ANSWERS");
  });
});

describe("buildUnexpectedErrorView", () => {
  it("with a bundle: the fixed text, one way out (start again) and the note near it", () => {
    const view = buildUnexpectedErrorView(bundle);
    expect(view.kind).toBe("UNEXPECTED_ERROR");
    expect(view.message).toBe("〈error.UNEXPECTED〉");
    expect(view.actions).toEqual([{ code: "RESTART", text: "〈action.RESTART〉" }]);
    expect(view.restartNote).toBe("〈error.UNEXPECTED.restartNote〉");
    expect(view.frame?.banner.text).toBe("〈banner.FIXTURE〉");
  });

  it("offers no review of the answers", () => {
    expect(buildUnexpectedErrorView(bundle).actions.map((action) => action.code)).not.toContain("REVIEW_ANSWERS");
  });

  it("holds fixed texts only: no answer, no question ID, no theme, no error content", () => {
    const text = JSON.stringify(buildUnexpectedErrorView(bundle));
    for (const leaked of ["q-ed-imp", "NOT_VERY_IMPORTANT", "防災", "Error", "stack"]) {
      expect(text).not.toContain(leaked);
    }
    expect(Object.keys(buildUnexpectedErrorView(bundle)).sort()).toEqual([
      "actions",
      "frame",
      "kind",
      "message",
      "restartNote",
    ]);
  });

  it("without a bundle: only the reload guide, no frame and no way out", () => {
    const view = buildUnexpectedErrorView(null);
    expect(view).toEqual({
      kind: "UNEXPECTED_ERROR",
      frame: null,
      message: RELOAD_GUIDE_TEXT,
      actions: [],
      restartNote: null,
    });
  });

  it("the reload guide has none of the banned words", () => {
    for (const banned of ["推奨", "おすすめ", "一致", "順位", "ランク", "あなたに合"]) {
      expect(RELOAD_GUIDE_TEXT).not.toContain(banned);
    }
  });
});