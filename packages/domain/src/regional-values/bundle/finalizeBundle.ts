import { RegionalBundleSchema } from "@ehime-vote-navigator/contracts";
import type { RegionalBundle } from "@ehime-vote-navigator/contracts";

import type { Result } from "../../result.js";
import type { BundleBody } from "./assembleBundleBody.js";
import { calculateContentHash, type Digest } from "./contentHash.js";

/**
 * Why a body cannot become a bundle: the contract of the bundle is not satisfied
 * (`CONTRACT_VIOLATION`), or the hash that was written does not come back from the bundle
 * (`HASH_MISMATCH`).
 */
export type FinalizeFailure = "CONTRACT_VIOLATION" | "HASH_MISMATCH";

/**
 * Makes a bundle of a body (design step 8): calculates `contentHash` (7.2), checks the bundle with
 * `RegionalBundleSchema`, and calculates the hash of the checked bundle again. The second hash
 * must be the first, which shows that the written bundle is the one that was hashed. A failure
 * returns no bundle. The body is not changed.
 */
export async function finalizeBundle(body: BundleBody, digest?: Digest): Promise<Result<RegionalBundle, FinalizeFailure>> {
  const contentHash = await calculateContentHash(body, digest);
  const parsed = RegionalBundleSchema.safeParse({ ...body, meta: { ...body.meta, contentHash } });
  if (!parsed.success) {
    return { ok: false, error: "CONTRACT_VIOLATION" };
  }
  const again = await calculateContentHash(parsed.data, digest);
  if (again !== contentHash) {
    return { ok: false, error: "HASH_MISMATCH" };
  }
  return { ok: true, value: parsed.data };
}
