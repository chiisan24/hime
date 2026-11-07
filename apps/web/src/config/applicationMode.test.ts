import { describe, expect, it } from "vitest";

import {
  createWebBuildMarker,
  parseWebBuildMarkerForTarget,
  resolveApplicationMode,
  resolveBuildTarget,
  WEB_BUILD_MARKER_FILENAME,
} from "./applicationMode.js";

describe("resolveApplicationMode", () => {
  it("selects ANALYST only for the exact analyst token", () => {
    expect(resolveApplicationMode("analyst")).toBe("ANALYST");
  });

  it.each([
    undefined,
    null,
    "",
    "development",
    "production",
    "test",
    "ANALYST",
    "Analyst",
    " analyst",
    "analyst ",
    1,
    false,
    {},
    [],
  ])("fails closed to VISITOR for invalid input %#", (mode) => {
    expect(resolveApplicationMode(mode)).toBe("VISITOR");
  });
});

describe("resolveBuildTarget", () => {
  it("selects the isolated analyst route entry and output directory", () => {
    expect(resolveBuildTarget("analyst")).toEqual({
      applicationMode: "ANALYST",
      outputDirectory: "dist-analyst",
      routeEntry: "analyst",
    });
  });

  it("selects the visitor route entry and output directory by default", () => {
    expect(resolveBuildTarget(undefined)).toEqual({
      applicationMode: "VISITOR",
      outputDirectory: "dist",
      routeEntry: "visitor",
    });
  });
});

describe("web build marker", () => {
  it("contains only the schema version, resolved mode, and output directory", () => {
    expect(WEB_BUILD_MARKER_FILENAME).toBe("web-build-marker.json");
    expect(createWebBuildMarker(resolveBuildTarget("analyst"))).toEqual({
      schemaVersion: 1,
      applicationMode: "ANALYST",
      outputDirectory: "dist-analyst",
    });
  });

  it("accepts only the exact marker for the expected build target", () => {
    const visitorTarget = resolveBuildTarget(undefined);
    const visitorMarker = createWebBuildMarker(visitorTarget);

    expect(parseWebBuildMarkerForTarget(visitorMarker, visitorTarget)).toEqual(
      visitorMarker,
    );
    expect(
      parseWebBuildMarkerForTarget(
        { ...visitorMarker, unexpected: true },
        visitorTarget,
      ),
    ).toBeNull();
    expect(
      parseWebBuildMarkerForTarget(
        visitorMarker,
        resolveBuildTarget("analyst"),
      ),
    ).toBeNull();
  });
});
