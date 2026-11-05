import type { Express } from "express";
import request from "supertest";

export type InProcessAppFactory = () => Express;

/** Creates a fresh Supertest client from an Express app without an external URL. */
export function createSupertestAppFactory(appFactory: InProcessAppFactory) {
  return () => request(appFactory());
}
