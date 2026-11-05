export const LOCAL_API_HOST = "127.0.0.1";
export const LOCAL_API_PORT = 8787;
export const PUBLIC_ENDPOINT_COUNT = 0;

export type LocalServerEnvironment = Readonly<{
  EHIME_API_HOST?: string | undefined;
  EHIME_API_PORT?: string | undefined;
}>;

export type LocalServerConfig = Readonly<{
  host: typeof LOCAL_API_HOST;
  port: typeof LOCAL_API_PORT;
  publicEndpointCount: typeof PUBLIC_ENDPOINT_COUNT;
}>;

export type LocalServerConfigurationErrorCode =
  | "UNSAFE_API_HOST"
  | "UNSAFE_API_PORT";

const CONFIGURATION_ERROR_MESSAGES: Readonly<
  Record<LocalServerConfigurationErrorCode, string>
> = Object.freeze({
  UNSAFE_API_HOST: "The API host must be the configured IPv4 loopback address.",
  UNSAFE_API_PORT: "The API port must be the configured local API port.",
});

/** A fixed-message startup failure that never reflects an unsafe host value. */
export class LocalServerConfigurationError extends Error {
  public readonly code: LocalServerConfigurationErrorCode;

  public constructor(code: LocalServerConfigurationErrorCode) {
    super(CONFIGURATION_ERROR_MESSAGES[code]);
    this.name = "LocalServerConfigurationError";
    this.code = code;
  }
}

/** Resolves the only supported API listener and rejects every override. */
export function resolveLocalServerConfig(
  environment: LocalServerEnvironment = process.env,
): LocalServerConfig {
  const configuredHost = environment.EHIME_API_HOST ?? LOCAL_API_HOST;
  const configuredPort = environment.EHIME_API_PORT ?? String(LOCAL_API_PORT);

  if (configuredHost !== LOCAL_API_HOST) {
    throw new LocalServerConfigurationError("UNSAFE_API_HOST");
  }
  if (configuredPort !== String(LOCAL_API_PORT)) {
    throw new LocalServerConfigurationError("UNSAFE_API_PORT");
  }

  return Object.freeze({
    host: LOCAL_API_HOST,
    port: LOCAL_API_PORT,
    publicEndpointCount: PUBLIC_ENDPOINT_COUNT,
  });
}
