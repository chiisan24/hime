import { describe, expect, it } from "vitest";

import {
  LOCAL_API_HOST,
  LOCAL_API_PORT,
  LocalServerConfigurationError,
  resolveLocalServerConfig,
} from "./localServerConfig.js";

describe("local API listener configuration", () => {
  it("defaults to one IPv4 loopback listener and zero public endpoints", () => {
    const config = resolveLocalServerConfig({});

    expect(config).toEqual({
      host: "127.0.0.1",
      port: 8787,
      publicEndpointCount: 0,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("accepts only the exact configured host and port", () => {
    expect(
      resolveLocalServerConfig({
        EHIME_API_HOST: LOCAL_API_HOST,
        EHIME_API_PORT: String(LOCAL_API_PORT),
      }),
    ).toEqual({
      host: LOCAL_API_HOST,
      port: LOCAL_API_PORT,
      publicEndpointCount: 0,
    });
  });

  it.each([
    "0.0.0.0",
    "::",
    "[::]",
    "0:0:0:0:0:0:0:0",
    "::1",
    "localhost",
    "192.168.1.20",
    "10.0.0.8",
    "hime.ngrok.example",
  ])("rejects unsafe or non-bindable host configuration %s", (host) => {
    expect(() => resolveLocalServerConfig({ EHIME_API_HOST: host })).toThrow(
      LocalServerConfigurationError,
    );

    try {
      resolveLocalServerConfig({ EHIME_API_HOST: host });
      throw new Error("Expected unsafe host configuration to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalServerConfigurationError);
      expect((error as LocalServerConfigurationError).code).toBe(
        "UNSAFE_API_HOST",
      );
      expect((error as Error).message).not.toContain(host);
    }
  });

  it.each(["0", "4173", "5173", "8787 ", "65536"])(
    "rejects a port other than 8787: %s",
    (port) => {
      expect(() => resolveLocalServerConfig({ EHIME_API_PORT: port })).toThrow(
        LocalServerConfigurationError,
      );
    },
  );
});
