import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatDate, formatDateTime } from "./formatDate.js";

describe("formatDate", () => {
  it.each([
    ["2026-05-01", "2026年5月1日"],
    ["2026-12-31", "2026年12月31日"],
    ["2024-02-29", "2024年2月29日"],
    ["2000-02-29", "2000年2月29日"],
  ])("%s is %s", (input, expected) => {
    expect(formatDate(input)).toBe(expected);
  });

  it.each(["2023-02-29", "1900-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-5-1", "2026-05-01T00:00:00Z", ""])(
    "rejects %j",
    (input) => {
      expect(() => formatDate(input)).toThrow(RangeError);
    },
  );
});

describe("formatDateTime (Japan Standard Time)", () => {
  it.each([
    ["2026-05-01T00:00:00Z", "2026年5月1日 09:00"],
    ["2026-05-01T15:00:00Z", "2026年5月2日 00:00"],
    ["2026-12-31T20:30:00Z", "2027年1月1日 05:30"],
    ["2024-02-28T16:00:00Z", "2024年2月29日 01:00"],
    ["2023-02-28T16:00:00Z", "2023年3月1日 01:00"],
    ["2024-02-29T14:59:00Z", "2024年2月29日 23:59"],
    ["2026-05-01T09:05:00+09:00", "2026年5月1日 09:05"],
    ["2026-05-01T00:00:00-05:00", "2026年5月1日 14:00"],
    ["2026-05-01T05:30:00+05:30", "2026年5月1日 09:00"],
    ["2026-05-01T08:59:59.999+09:00", "2026年5月1日 08:59"],
    ["2026-05-01T08:59+09:00", "2026年5月1日 08:59"],
  ])("%s is %s", (input, expected) => {
    expect(formatDateTime(input)).toBe(expected);
  });

  it.each([
    "2026-05-01T00:00:00",
    "2026-05-01",
    "2026-02-30T00:00:00Z",
    "2026-05-01T24:00:00Z",
    "2026-05-01T12:60:00Z",
    "2026-05-01T12:00:00+24:00",
    "2026-05-01 12:00:00Z",
    "",
  ])("rejects %j", (input) => {
    expect(() => formatDateTime(input)).toThrow(RangeError);
  });

  // An independent check against the platform clock arithmetic (UTC fields of Date), 1970 to 2100.
  it("agrees with a reference made from Date.UTC for random instants", () => {
    const pad = (value: number): string => String(value).padStart(2, "0");
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_102_444_800 }), (seconds) => {
        const utc = new Date(seconds * 1000);
        const instant = `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}T${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())}:${pad(utc.getUTCSeconds())}Z`;
        const jst = new Date(seconds * 1000 + 9 * 3600 * 1000);
        const expected = `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日 ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
        expect(formatDateTime(instant)).toBe(expected);
      }),
      { seed: 350_055, numRuns: 200 },
    );
  });
});