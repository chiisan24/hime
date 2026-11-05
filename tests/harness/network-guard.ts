import { BedrockClient } from "@aws-sdk/client-bedrock";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { STSClient } from "@aws-sdk/client-sts";

export class ExternalIoBlockedError extends Error {
  public readonly operation: string;

  public constructor(operation: string) {
    super(
      `External I/O is disabled during normal tests: ${operation}. ` +
        "Replace the dependency with an explicit fake.",
    );
    this.name = "ExternalIoBlockedError";
    this.operation = operation;
  }
}

type AwsClientClass = Readonly<{
  name: string;
  prototype: object;
}>;

const awsClientClasses: readonly AwsClientClass[] = [
  BedrockClient,
  BedrockRuntimeClient,
  STSClient,
];

function block(operation: string): never {
  throw new ExternalIoBlockedError(operation);
}

function defineGuardedValue(
  target: object,
  property: PropertyKey,
  value: unknown,
): void {
  Object.defineProperty(target, property, {
    configurable: true,
    enumerable: false,
    value,
    writable: true,
  });
}

/** Installs fail-fast guards for every external transport used by P0 code. */
export function installExternalIoGuard(): void {
  defineGuardedValue(globalThis, "fetch", function blockedFetch(): never {
    return block("fetch");
  });

  defineGuardedValue(
    globalThis,
    "XMLHttpRequest",
    class BlockedXMLHttpRequest {
      public constructor() {
        block("XMLHttpRequest");
      }
    },
  );

  defineGuardedValue(
    globalThis,
    "WebSocket",
    class BlockedWebSocket {
      public constructor() {
        block("WebSocket");
      }
    },
  );

  const navigatorValue: unknown = Reflect.get(globalThis, "navigator");
  const blockedSendBeacon = function blockedSendBeacon(): never {
    return block("navigator.sendBeacon");
  };

  if (typeof navigatorValue === "object" && navigatorValue !== null) {
    defineGuardedValue(navigatorValue, "sendBeacon", blockedSendBeacon);
  } else {
    defineGuardedValue(globalThis, "navigator", {
      sendBeacon: blockedSendBeacon,
    });
  }

  for (const AwsClient of awsClientClasses) {
    defineGuardedValue(AwsClient.prototype, "send", function blockedAwsSend(): never {
      return block(`${AwsClient.name}.send`);
    });
  }
}
