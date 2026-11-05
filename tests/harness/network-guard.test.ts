import {
  BedrockClient,
  ListFoundationModelsCommand,
} from "@aws-sdk/client-bedrock";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { describe, expect, it, vi } from "vitest";

import { ExternalIoBlockedError } from "./network-guard.js";

describe("external I/O guard", () => {
  it("fails fast for un-stubbed browser transports", () => {
    expect(() => fetch("https://blocked.invalid/")).toThrowError(
      ExternalIoBlockedError,
    );
    expect(() => new XMLHttpRequest()).toThrow(/XMLHttpRequest/);
    expect(() => new WebSocket("wss://blocked.invalid/")).toThrow(/WebSocket/);
    expect(() => navigator.sendBeacon("https://blocked.invalid/", "payload")).toThrow(
      /sendBeacon/,
    );
  });

  it("fails before each configured AWS client can send", () => {
    const region = "ap-northeast-1";
    const bedrock = new BedrockClient({ region });
    const runtime = new BedrockRuntimeClient({ region });
    const sts = new STSClient({ region });

    expect(() => bedrock.send(new ListFoundationModelsCommand({}))).toThrow(
      /BedrockClient\.send/,
    );
    expect(() =>
      runtime.send(
        new InvokeModelCommand({
          body: new Uint8Array(),
          contentType: "application/json",
          modelId: "fixture-model",
        }),
      ),
    ).toThrow(/BedrockRuntimeClient\.send/);
    expect(() => sts.send(new GetCallerIdentityCommand({}))).toThrow(
      /STSClient\.send/,
    );
  });

  it("allows browser transports replaced by explicit fakes", async () => {
    class FakeXMLHttpRequest {}
    class FakeWebSocket {}

    const fakeFetch = vi.fn(async () => new Response("fixture response"));
    vi.stubGlobal("fetch", fakeFetch);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const sendBeacon = vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);

    await expect(fetch("https://fake.invalid/")).resolves.toHaveProperty(
      "status",
      200,
    );
    expect(new XMLHttpRequest()).toBeInstanceOf(FakeXMLHttpRequest);
    expect(new WebSocket("wss://fake.invalid/")).toBeInstanceOf(FakeWebSocket);
    expect(navigator.sendBeacon("https://fake.invalid/", "fixture")).toBe(true);
    expect(fakeFetch).toHaveBeenCalledOnce();
    expect(sendBeacon).toHaveBeenCalledOnce();
  });

  it("allows a fake AWS port with its own send implementation", async () => {
    const fakeClient = {
      send: vi.fn(async () => ({ source: "explicit-fake" as const })),
    };

    await expect(fakeClient.send()).resolves.toEqual({ source: "explicit-fake" });
    expect(fakeClient.send).toHaveBeenCalledOnce();
  });
});
