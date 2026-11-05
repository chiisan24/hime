import { serializeRedactedValue } from "@ehime-vote-navigator/domain";

export const SAFE_LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;
export type SafeLogLevel = (typeof SAFE_LOG_LEVELS)[number];

export type SafeLogWriter = (serializedEvent: string) => void;

export type SafeLogger = Readonly<{
  debug: (event: unknown) => void;
  error: (event: unknown) => void;
  info: (event: unknown) => void;
  log: (level: SafeLogLevel, event: unknown) => void;
  warn: (event: unknown) => void;
}>;

const SAFE_LOG_REJECTION_MESSAGE =
  "The log event was rejected before serialization.";

function rejectionLine(level: SafeLogLevel): string {
  return JSON.stringify({
    level,
    event: {
      code: "LOG_EVENT_REJECTED",
      message: SAFE_LOG_REJECTION_MESSAGE,
    },
  });
}

/** Serializes a redacted clone or a fixed value-free rejection event. */
export function serializeSafeLogEvent(
  level: SafeLogLevel,
  event: unknown,
): string {
  try {
    return serializeRedactedValue({ event, level });
  } catch {
    return rejectionLine(level);
  }
}

/**
 * Creates a logger whose writer receives only already-redacted serialized text.
 * Callers never pass raw event objects to the configured sink.
 */
export function createSafeLogger(writer: SafeLogWriter): SafeLogger {
  const log = (level: SafeLogLevel, event: unknown): void => {
    writer(serializeSafeLogEvent(level, event));
  };

  return Object.freeze({
    debug: (event: unknown) => {
      log("DEBUG", event);
    },
    error: (event: unknown) => {
      log("ERROR", event);
    },
    info: (event: unknown) => {
      log("INFO", event);
    },
    log,
    warn: (event: unknown) => {
      log("WARN", event);
    },
  });
}
