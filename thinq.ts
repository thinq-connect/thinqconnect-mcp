// LG ThinQ Connect Open API client.
//
// A port of the HTTP layer of the official `thinqconnect` Python SDK
// (https://github.com/thinq-connect/pythinqconnect, Apache-2.0): same base
// URL rule, same headers, same 15 s timeout, and the same error contract --
// a non-2xx answer is raised as `ThinQApiError` carrying the ThinQ error code
// and message, so a caller can tell "device offline" (1222) from "command not
// allowed while powered off" (2304) from "bad token" (1103).

// The API key is a public constant hard-coded in the SDK (thinqconnect/const.py).
// It identifies the ThinQ Open API product, not this account; the account
// credential is THINQ_PAT.
export const THINQ_API_KEY = "v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3";
export const THINQ_CLIENT_ID = "thinqconnect-mcp-client";
export const THINQ_TIMEOUT_MS = 15_000;

export interface ThinQEnv {
  THINQ_PAT: string;
  THINQ_COUNTRY: string;
}

// --- region ------------------------------------------------------------------
// SDK: thinqconnect/country.py SUPPORTED_COUNTRIES. An unsupported country is
// an error, as in the SDK, rather than a silent fallback to Korea.

const REGION_COUNTRIES: Record<string, string> = {
  kic: "AU BD CN HK ID IN JP KH KR LA LK MM MY NP NZ PH SG TH TW VN",
  aic: "AG AR AW BB BO BR BS BZ CA CL CO CR CU DM DO EC GD GT GY HN HT JM KN LC MX NI PA PE PR PY SR SV TT US UY VC VE",
  eic: "AE AF AL AM AO AT AZ BA BE BF BG BH BJ BY CD CF CG CH CI CM CV CY CZ DE DJ DK DZ EE EG ES ET FI FR GA GB GE GH GM GN GQ GR HR HU IE IL IQ IR IS IT JO KE KG KW KZ LB LR LT LU LV LY MA MD ME MK ML MR MT MU MW NE NG NL NO OM PK PL PS PT QA RO RS RU RW SA SD SE SI SK SL SN SO ST SY TD TG TN TR TZ UA UG UZ XK YE ZA ZM",
};

const COUNTRY_TO_REGION: Record<string, string> = {};
for (const [region, list] of Object.entries(REGION_COUNTRIES)) {
  for (const cc of list.split(" ")) COUNTRY_TO_REGION[cc] = region;
}

export function thinqRegion(country: string): string {
  const region = COUNTRY_TO_REGION[country.trim().toUpperCase()];
  if (region === undefined) throw new Error("Not supported country_code: " + country);
  return region;
}

export function thinqBaseUrl(country: string): string {
  return "https://api-" + thinqRegion(country) + ".lgthinq.com";
}

// --- errors ------------------------------------------------------------------
// SDK: thinqconnect/thinq_api.py ThinQAPIErrorCodes.

export const THINQ_ERROR_NAMES: Record<string, string> = {
  "0000": "UNKNOWN_ERROR",
  "1000": "BAD_REQUEST",
  "1101": "MISSING_PARAMETERS",
  "1102": "UNACCEPTABLE_PARAMETERS",
  "1103": "INVALID_TOKEN",
  "1104": "INVALID_MESSAGE_ID",
  "1201": "NOT_REGISTERED_ADMIN",
  "1202": "NOT_REGISTERED_USER",
  "1203": "NOT_REGISTERED_SERVICE",
  "1204": "NOT_SUBSCRIBED_EVENT",
  "1205": "NOT_EXIST_DEVICE",
  "1206": "NOT_SUBSCRIBED_PUSH",
  "1207": "ALREADY_SUBSCRIBED_PUSH",
  "1208": "NOT_REGISTERED_SERVICE_BY_ADMIN",
  "1209": "NOT_REGISTERED_USER_IN_SERVICE",
  "1210": "NOT_REGISTERED_DEVICE_IN_SERVICE",
  "1211": "NOT_REGISTERED_DEVICE_BY_USER",
  "1212": "NOT_OWNED_DEVICE",
  "1213": "NOT_REGISTERED_DEVICE",
  "1214": "NOT_SUBSCRIBABLE_DEVICE",
  "1216": "INCORRECT_HEADER",
  "1217": "ALREADY_DEVICE_DELETED",
  "1218": "INVALID_TOKEN_AGAIN",
  "1219": "NOT_SUPPORTED_MODEL",
  "1220": "NOT_SUPPORTED_FEATURE",
  "1221": "NOT_SUPPORTED_PRODUCT",
  "1222": "NOT_CONNECTED_DEVICE",
  "1223": "INVALID_STATUS_DEVICE",
  "1224": "INVALID_DEVICE_ID",
  "1225": "DUPLICATE_DEVICE_ID",
  "1301": "INVALID_SERVICE_KEY",
  "1302": "NOT_FOUND_TOKEN",
  "1303": "NOT_FOUND_USER",
  "1304": "NOT_ACCEPTABLE_TERMS",
  "1305": "NOT_ALLOWED_API",
  "1306": "EXCEEDED_API_CALLS",
  "1307": "NOT_SUPPORTED_COUNTRY",
  "1308": "NO_CONTROL_AUTHORITY",
  "1309": "NOT_ALLOWED_API_AGAIN",
  "1310": "NOT_SUPPORTED_DOMAIN",
  "1311": "BAD_REQUEST_FORMAT",
  "1312": "EXCEEDED_NUMBER_OF_EVENT_SUBSCRIPTION",
  "2000": "INTERNAL_SERVER_ERROR",
  "2101": "NOT_SUPPORTED_MODEL_AGAIN",
  "2201": "NOT_PROVIDED_FEATURE",
  "2202": "NOT_SUPPORTED_PRODUCT_AGAIN",
  "2203": "NOT_EXISTENT_MODEL_JSON",
  "2205": "INVALID_DEVICE_STATUS",
  "2207": "INVALID_COMMAND_ERROR",
  "2208": "FAIL_DEVICE_CONTROL",
  "2209": "DEVICE_RESPONSE_DELAY",
  "2210": "RETRY_REQUEST",
  "2212": "SYNCING",
  "2213": "RETRY_AFTER_DELETING_DEVICE",
  "2214": "FAIL_REQUEST",
  "2301": "COMMAND_NOT_SUPPORTED_IN_REMOTE_OFF",
  "2302": "COMMAND_NOT_SUPPORTED_IN_STATE",
  "2303": "COMMAND_NOT_SUPPORTED_IN_ERROR",
  "2304": "COMMAND_NOT_SUPPORTED_IN_POWER_OFF",
  "2305": "COMMAND_NOT_SUPPORTED_IN_MODE",
};

/** A non-2xx answer from the ThinQ API. `toString()` matches the SDK's ThinQAPIException. */
export class ThinQApiError extends Error {
  readonly code: string;
  readonly errorName: string;
  readonly status: number;
  readonly apiMessage: string;

  constructor(status: number, code: string, message: string) {
    const errorName = THINQ_ERROR_NAMES[code] ?? "UNKNOWN_ERROR";
    super("ThinQAPIException: " + errorName + " (" + code + ") - " + message);
    this.name = "ThinQApiError";
    this.status = status;
    this.code = code;
    this.errorName = errorName;
    this.apiMessage = message;
  }

  override toString(): string {
    return this.message;
  }
}

/** Build the error for a failed response. Exported so the body parsing is testable without fetch. */
export async function thinqErrorFrom(resp: Response): Promise<ThinQApiError> {
  let body: any = null;
  try {
    body = await resp.json();
  } catch {
    // Not JSON (an HTML error page from a proxy, an empty 502). Fall through.
  }
  const err = body && typeof body === "object" ? body.error : undefined;
  const code = err && typeof err.code === "string" ? err.code : "unknown error code";
  const message = err && typeof err.message === "string" ? err.message : "HTTP " + resp.status;
  return new ThinQApiError(resp.status, code, message);
}

// ThinQ wraps most endpoints in { response: ... }; a few return the body bare.
export function unwrapThinqResponse(data: unknown): unknown {
  return data && typeof data === "object" && "response" in (data as object)
    ? (data as any).response
    : data;
}

export function messageId(): string {
  // SDK format: url-safe base64 of 16 random bytes, padding stripped.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export interface ThinQRequest {
  method: "GET" | "POST";
  endpoint: string;
  body?: unknown;
  /** Only device control sends x-conditional-control, as in the SDK. */
  conditionalControl?: boolean;
}

export async function thinqRequest(env: ThinQEnv, req: ThinQRequest): Promise<unknown> {
  const url = thinqBaseUrl(env.THINQ_COUNTRY) + "/" + req.endpoint;
  const headers: Record<string, string> = {
    authorization: "Bearer " + env.THINQ_PAT,
    "x-country": env.THINQ_COUNTRY,
    "x-message-id": messageId(),
    "x-client-id": THINQ_CLIENT_ID,
    "x-api-key": THINQ_API_KEY,
    "x-service-phase": "OP",
  };
  if (req.conditionalControl) headers["x-conditional-control"] = "true";
  if (req.body !== undefined) headers["content-type"] = "application/json";

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: req.method,
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(THINQ_TIMEOUT_MS),
    });
  } catch (e) {
    // AbortSignal.timeout rejects with a DOMException named TimeoutError.
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new Error("ThinQ API timeout after " + THINQ_TIMEOUT_MS / 1000 + "s for " + req.endpoint);
    }
    throw e;
  }
  if (!resp.ok) throw await thinqErrorFrom(resp);
  return unwrapThinqResponse(await resp.json());
}

export const getDeviceList = (env: ThinQEnv) =>
  thinqRequest(env, { method: "GET", endpoint: "devices" });
export const getDeviceProfile = (env: ThinQEnv, id: string) =>
  thinqRequest(env, { method: "GET", endpoint: "devices/" + encodeURIComponent(id) + "/profile" });
export const getDeviceStatus = (env: ThinQEnv, id: string) =>
  thinqRequest(env, { method: "GET", endpoint: "devices/" + encodeURIComponent(id) + "/state" });
export const postDeviceControl = (env: ThinQEnv, id: string, payload: unknown) =>
  thinqRequest(
    env,
    { method: "POST", endpoint: "devices/" + encodeURIComponent(id) + "/control", body: payload, conditionalControl: true },
  );
