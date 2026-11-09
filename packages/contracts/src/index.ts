import { z } from "zod";

export * from "./api/index.js";
export * from "./aws-config.js";
export * from "./data-kind.js";
export * from "./models/index.js";
export * from "./provider/index.js";

export const ContractPackageHealthSchema = z
  .object({
    package: z.literal("contracts"),
    status: z.literal("ok"),
  })
  .strict();

export type ContractPackageHealth = z.infer<typeof ContractPackageHealthSchema>;

export function getContractPackageHealth(): ContractPackageHealth {
  return ContractPackageHealthSchema.parse({
    package: "contracts",
    status: "ok",
  });
}
