/**
 * Browser entry of the regional values map (`@ehime-vote-navigator/domain/regional-values`).
 *
 * Only the pure calculation, the diagnostic state machine, the result view models and
 * the fetch and verification of the published bundle are exported. The question bank
 * checks, the content checks, the gate and the bundle assembly are build-time code and
 * are not reachable from here. The bundle modules are named one by one, not through
 * `bundle/index.ts`, so a module that is added there later is not published by accident.
 *
 * Everything reachable from this file must run in a browser: no `node:*` module, no
 * `Buffer`, `process` or `require`, no read of the current time and no random number.
 */
export * from "./map/index.js";
export * from "./session/index.js";
export * from "./view/index.js";
export * from "./bundle/loadBundle.js";
export * from "./bundle/loadFailureTexts.js";
export * from "./bundle/verifyBundleText.js";
export type { Digest } from "./bundle/contentHash.js";
