import type { Result } from "../../result.js";
import type { Digest } from "./contentHash.js";
import { verifyBundleText } from "./verifyBundleText.js";
import type { BundleLoadErrorCode, ExpectedBundle, VerifiedBundle } from "./verifyBundleText.js";

/** Maximum UTF-8 body size of a bundle. A larger response is not parsed. */
export const MAX_BUNDLE_BYTES = 2_000_000;

export const BUNDLE_GET_INIT = {
  method: "GET",
  cache: "no-cache",
  credentials: "omit",
  redirect: "error",
  referrerPolicy: "no-referrer",
} as const;

export type BundleHttpResponse = Readonly<{
  ok: boolean;
  text: () => Promise<string>;
}>;

/** The browser supplies fetch through this boundary; domain code never references fetch directly. */
export type HttpGet = (url: string, init: typeof BUNDLE_GET_INIT) => Promise<BundleHttpResponse>;

export type LoadBundleInput = Readonly<{
  httpGet: HttpGet;
  url: string;
  expected: ExpectedBundle;
  digest?: Digest;
}>;

/**
 * Gets one bundle once, without credentials or redirects. It never retries or switches
 * to a second URL. A failure returns only its stable code and no response text.
 */
export async function loadBundle(input: LoadBundleInput): Promise<Result<VerifiedBundle, BundleLoadErrorCode>> {
  let response: BundleHttpResponse;
  try {
    response = await input.httpGet(input.url, BUNDLE_GET_INIT);
  } catch {
    return { ok: false, error: "FETCH_FAILED" };
  }
  if (!response.ok) {
    return { ok: false, error: "FETCH_FAILED" };
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { ok: false, error: "FETCH_FAILED" };
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BUNDLE_BYTES) {
    return { ok: false, error: "TOO_LARGE" };
  }
  return verifyBundleText(text, input.expected, input.digest);
}