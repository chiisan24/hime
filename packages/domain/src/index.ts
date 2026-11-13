export * from "./analysis/passages.js";
export * from "./data-kind/validateDataBoundary.js";
export * from "./election/registry.js";
export * from "./provider/decodeProviderResult.js";
export * from "./regional-values/index.js";
export * from "./runs/foldRunEvents.js";
export * from "./security/redact.js";
export * from "./serialization/canonicalJson.js";
export * from "./serialization/contentHash.js";
export * from "./result.js";

export type PackageHealth = Readonly<{
  package: "domain";
  status: "ok";
}>;

export function getDomainPackageHealth(): PackageHealth {
  return {
    package: "domain",
    status: "ok",
  };
}
