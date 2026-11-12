import { Sha256Schema, type Sha256 } from "@ehime-vote-navigator/contracts";

import { encodePortableCanonicalJson } from "./portableCanonicalJson.js";

/** A browser hash function. Supplying one makes the calculation deterministic in a test. */
export type Digest = (input: Uint8Array) => Promise<ArrayBuffer>;

export type BundleWithMeta = Readonly<{
  meta: object;
  [key: string]: unknown;
}>;

/** Returns an independent bundle-shaped value without meta.contentHash. It does not mutate the input. */
export function withoutContentHash(bundle: BundleWithMeta): BundleWithMeta {
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bundle.meta)) {
    if (key !== "contentHash") {
      meta[key] = value;
    }
  }
  return { ...bundle, meta };
}

async function browserDigest(input: Uint8Array): Promise<ArrayBuffer> {
  if (globalThis.crypto === undefined || globalThis.crypto.subtle === undefined) {
    throw new Error("WebCrypto SHA-256 is unavailable");
  }
  return globalThis.crypto.subtle.digest("SHA-256", input);
}

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Calculates the lower-case SHA-256 of canonical UTF-8 JSON after removing the
 * contentHash field. This is browser-safe and does not modify the bundle.
 */
export async function calculateContentHash(bundle: BundleWithMeta, digest: Digest = browserDigest): Promise<Sha256> {
  const bytes = encodePortableCanonicalJson(withoutContentHash(bundle));
  const hash = hexOf(new Uint8Array(await digest(bytes)));
  return Sha256Schema.parse(hash);
}