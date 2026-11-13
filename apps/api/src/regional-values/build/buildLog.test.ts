import { describe, expect, it } from "vitest";

import { createSafeLogger } from "../../logging/safeLogger.js";
import { logBuildDone, logBuildStart, logDataModeSwitched, logRealDataInsufficient } from "./buildLog.js";

function collect(): { lines: string[]; logger: ReturnType<typeof createSafeLogger> } {
  const lines: string[] = [];
  return { lines, logger: createSafeLogger((line) => lines.push(line)) };
}

describe("the build log", () => {
  it("writes the four events of the design with the same keys and values, in the key order of the safe logger", () => {
    const { lines, logger } = collect();
    logBuildStart(logger, "DEMO", "REAL_PREFERRED");
    logRealDataInsufficient(logger, 3, 0);
    logDataModeSwitched(logger, "REAL_PREFERRED", "FIXTURE", ["FACT_NOT_VERIFIED", "NOTE_REVIEW_MISSING", "TRANSMISSION_NOT_ALLOWED"]);
    logBuildDone(logger, "FIXTURE", 0);
    // The design says that the order of the keys follows the safe logger, which sorts them.
    expect(lines).toEqual([
      '{"event":{"buildKind":"DEMO","code":"BUILD_START","dataModeRequested":"REAL_PREFERRED"},"level":"INFO"}',
      '{"event":{"code":"REAL_DATA_INSUFFICIENT","defectCount":0,"shortageCount":3},"level":"INFO"}',
      '{"event":{"code":"DATA_MODE_SWITCHED","from":"REAL_PREFERRED","reasonCodes":["FACT_NOT_VERIFIED","NOTE_REVIEW_MISSING","TRANSMISSION_NOT_ALLOWED"],"to":"FIXTURE"},"level":"WARN"}',
      '{"event":{"code":"BUILD_DONE","dataKind":"FIXTURE","exitCode":0},"level":"INFO"}',
    ]);
    // The same events as the objects of the design example.
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { event: { code: "BUILD_START", buildKind: "DEMO", dataModeRequested: "REAL_PREFERRED" }, level: "INFO" },
      { event: { code: "REAL_DATA_INSUFFICIENT", shortageCount: 3, defectCount: 0 }, level: "INFO" },
      {
        event: {
          code: "DATA_MODE_SWITCHED",
          from: "REAL_PREFERRED",
          to: "FIXTURE",
          reasonCodes: ["FACT_NOT_VERIFIED", "NOTE_REVIEW_MISSING", "TRANSMISSION_NOT_ALLOWED"],
        },
        level: "WARN",
      },
      { event: { code: "BUILD_DONE", dataKind: "FIXTURE", exitCode: 0 }, level: "INFO" },
    ]);
  });

  it("writes the end of a failed build with no data kind", () => {
    const { lines, logger } = collect();
    logBuildDone(logger, null, 1);
    expect(lines).toEqual(['{"event":{"code":"BUILD_DONE","dataKind":null,"exitCode":1},"level":"INFO"}']);
  });

  it("writes each line as JSON of one event", () => {
    const { lines, logger } = collect();
    logBuildStart(logger, "PUBLIC", "REAL");
    logBuildDone(logger, "REAL_AI", 0);
    for (const line of lines) {
      const parsed: unknown = JSON.parse(line);
      expect(parsed).toMatchObject({ event: { code: expect.any(String) }, level: expect.any(String) });
    }
  });

  it("sends every event through the safe logger, which does not write a value that looks like a credential", () => {
    const { lines, logger } = collect();
    // The events above carry typed codes only. The logger they go through is the one that protects
    // a line, so a credential placed in an event of the same shape does not reach the writer.
    logger.info({ code: "BUILD_START", buildKind: "DEMO", dataModeRequested: "FIXTURE", authorization: "Bearer sk-test-secret-token-0123456789" });
    expect(lines.join("\n")).not.toContain("sk-test-secret-token-0123456789");
    expect(lines).toHaveLength(1);
  });

  it("carries no answer, key or text: only codes and numbers", () => {
    const { lines, logger } = collect();
    logBuildStart(logger, "DEMO", "FIXTURE");
    logRealDataInsufficient(logger, 0, 0);
    logDataModeSwitched(logger, "REAL_PREFERRED", "FIXTURE", ["REAL_DATA_ABSENT"]);
    logBuildDone(logger, "FIXTURE", 0);
    for (const line of lines) {
      expect(Object.keys((JSON.parse(line) as { event: object }).event).sort()).not.toContain("answers");
    }
    expect(lines.join("\n")).not.toMatch(/answer|apiKey|password|secret|token/iu);
  });
});
