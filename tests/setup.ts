import "@testing-library/jest-dom/vitest";

import { beforeEach } from "vitest";

import { installExternalIoGuard } from "./harness/network-guard.js";
import { installFastCheckDefaults } from "./harness/fast-check.js";

installFastCheckDefaults();
installExternalIoGuard();

beforeEach(() => {
  installExternalIoGuard();
});
