import { REDACTED_VALUE } from "@ehime-vote-navigator/domain";
import { describe, expect, it, vi } from "vitest";

import { createSafeLogger, serializeSafeLogEvent } from "./safeLogger.js";

const FICTIONAL_ACCESS_KEY_ID = `AKIA${"FAKE".repeat(4)}`;
const FICTIONAL_BEARER_TOKEN = "Bearer fictional.header.signature";

describe("safe logger", () => {
  it("passes only serialized redacted clones to its writer", () => {
    const writer = vi.fn<(serializedEvent: string) => void>();
    const logger = createSafeLogger(writer);
    const event = {
      operation: "fictional-operation",
      nested: [{ authorization: FICTIONAL_BEARER_TOKEN }],
      detail: FICTIONAL_ACCESS_KEY_ID,
    };

    logger.info(event);

    expect(writer).toHaveBeenCalledOnce();
    const line = writer.mock.calls[0]?.[0];
    expect(line).toBeDefined();
    expect(JSON.parse(line ?? "null")).toEqual({
      event: {
        detail: REDACTED_VALUE,
        nested: [{ authorization: REDACTED_VALUE }],
        operation: "fictional-operation",
      },
      level: "INFO",
    });
    expect(line).not.toContain(FICTIONAL_ACCESS_KEY_ID);
    expect(line).not.toContain("fictional.header.signature");
    expect(event.detail).toBe(FICTIONAL_ACCESS_KEY_ID);
  });

  it("writes a fixed rejection event for unsafe input without invoking getters", () => {
    let getterCalls = 0;
    const unsafe = {};
    Object.defineProperty(unsafe, "detail", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return FICTIONAL_ACCESS_KEY_ID;
      },
    });

    const line = serializeSafeLogEvent("ERROR", unsafe);

    expect(JSON.parse(line)).toEqual({
      event: {
        code: "LOG_EVENT_REJECTED",
        message: "The log event was rejected before serialization.",
      },
      level: "ERROR",
    });
    expect(line).not.toContain(FICTIONAL_ACCESS_KEY_ID);
    expect(getterCalls).toBe(0);
  });

  it("provides fixed-level convenience methods", () => {
    const lines: string[] = [];
    const logger = createSafeLogger((line) => {
      lines.push(line);
    });

    logger.debug({ value: "safe" });
    logger.warn({ value: "safe" });
    logger.error({ value: "safe" });
    logger.log("INFO", { value: "safe" });

    expect(lines.map((line) => JSON.parse(line).level)).toEqual([
      "DEBUG",
      "WARN",
      "ERROR",
      "INFO",
    ]);
  });
});
