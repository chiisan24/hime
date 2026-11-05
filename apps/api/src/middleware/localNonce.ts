import { randomBytes, timingSafeEqual } from "node:crypto";

const LOCAL_NONCE_BYTES = 32;

export interface LocalNonce {
  /** Exposes the nonce only to the guarded localhost session route. */
  revealForSession(): string;
  /** Compares a request value without reflecting either value. */
  matches(candidate: string | undefined): boolean;
}

/** Creates a process-local 256-bit nonce. The value exists only in this closure. */
export function createLocalNonce(): LocalNonce {
  const value = randomBytes(LOCAL_NONCE_BYTES).toString("base64url");
  const expectedBytes = Buffer.from(value, "utf8");

  return Object.freeze({
    matches(candidate: string | undefined): boolean {
      if (candidate === undefined) {
        return false;
      }

      const candidateBytes = Buffer.from(candidate, "utf8");
      return (
        candidateBytes.byteLength === expectedBytes.byteLength &&
        timingSafeEqual(candidateBytes, expectedBytes)
      );
    },
    revealForSession(): string {
      return value;
    },
  });
}
