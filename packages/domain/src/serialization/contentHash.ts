import { createHash } from "node:crypto";

import { Sha256Schema, type Sha256 } from "@ehime-vote-navigator/contracts";

import { encodeCanonicalJson, formatCanonicalJson } from "./canonicalJson.js";

export type ContentHash = Sha256;

export type CanonicalJsonArtifact = Readonly<{
  bytes: Uint8Array;
  contentHash: ContentHash;
  text: string;
}>;

/** Computes a lowercase SHA-256 digest using Node's standard implementation. */
export function sha256Hex(input: string | Uint8Array): ContentHash {
  const digest = createHash("sha256")
    .update(input instanceof Uint8Array ? input : Buffer.from(input, "utf8"))
    .digest("hex");

  return Sha256Schema.parse(digest);
}

/** Computes the content hash of the canonical UTF-8 JSON representation. */
export function hashCanonicalJson(value: unknown): ContentHash {
  return sha256Hex(encodeCanonicalJson(value));
}

/** Produces one internally consistent canonical text/byte/hash snapshot. */
export function createCanonicalJsonArtifact(
  value: unknown,
): CanonicalJsonArtifact {
  const text = formatCanonicalJson(value);
  const bytes = new TextEncoder().encode(text);

  return Object.freeze({
    bytes,
    contentHash: sha256Hex(bytes),
    text,
  });
}
