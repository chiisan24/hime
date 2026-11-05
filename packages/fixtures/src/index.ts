import {
  FixtureDataRecordSchema,
  type DataBoundaryPayload,
  type FixtureDataRecord,
} from "@ehime-vote-navigator/contracts";

export * from "./provider/index.js";

export type FixturePackageHealth = Readonly<{
  package: "fixtures";
  status: "ok";
  fictionalOnly: true;
}>;

export type FixtureDataRecordSeed = Readonly<{
  payload: DataBoundaryPayload;
  recordId: string;
}>;

export type { FixtureDataRecord };

export function getFixturePackageHealth(): FixturePackageHealth {
  return {
    package: "fixtures",
    status: "ok",
    fictionalOnly: true,
  };
}

/** Creates only a schema-validated FIXTURE record for test/dev providers. */
export function createFixtureDataRecord(
  seed: FixtureDataRecordSeed,
): FixtureDataRecord {
  return FixtureDataRecordSchema.parse({
    dataKind: "FIXTURE",
    payload: seed.payload,
    recordId: seed.recordId,
  });
}
