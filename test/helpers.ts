import worker, { type Env } from "../index";

export const env: Env = { THINQ_PAT: "pat-under-test", THINQ_COUNTRY: "KR" };

/** A well-formed identity, as the gateway sends it. */
export const IDENTITY = {
  "x-lost-plus-sub": "42",
  "x-lost-plus-email": "me%40lost.plus",
  "x-lost-plus-name": "%EC%82%AC%EC%9A%A9%EC%9E%90",
  "x-lost-plus-role": "user",
  "x-lost-plus-encoding": "percent-utf8",
};

export const MODERN = "2026-07-28";

/** The per-request `_meta` envelope every 2026-07-28 request must carry. */
export function modernMeta(): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/protocolVersion": MODERN,
    "io.modelcontextprotocol/clientCapabilities": {},
  };
}

export interface RpcResponse {
  status: number;
  contentType: string | null;
  body: any;
}

/**
 * POST one JSON-RPC message to the Worker and return the decoded reply. The
 * 2025-era transport answers with an SSE stream carrying one `data:` line; the
 * 2026-era path answers with a plain JSON body. Both are read here.
 */
export async function rpc(
  message: Record<string, unknown>,
  options: { path?: string; headers?: Record<string, string>; env?: Env; identity?: boolean } = {},
): Promise<RpcResponse> {
  const response = await worker.fetch(
    new Request(`https://thinq.lost.plus${options.path ?? "/mcp"}`, {
      method: "POST",
      headers: {
        ...(options.identity === false ? {} : IDENTITY),
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...options.headers,
      },
      body: JSON.stringify(message),
    }),
    options.env ?? env,
  );
  const contentType = response.headers.get("content-type");
  const raw = await response.text();
  let body: any = null;
  if (raw !== "") {
    if (contentType?.startsWith("text/event-stream")) {
      const data = raw
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice("data: ".length));
      body = data.length === 1 ? JSON.parse(data[0]!) : data.map((d) => JSON.parse(d));
    } else {
      body = JSON.parse(raw);
    }
  }
  return { status: response.status, contentType, body };
}

/** A 2025-era request: no envelope, version negotiated at initialize. */
export function legacy(method: string, params?: Record<string, unknown>, id = 1, options: { path?: string } = {}) {
  return rpc({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }, options);
}

/** A 2026-07-28 request: envelope in `_meta`, plus the version and method headers. */
export function modern(method: string, params: Record<string, unknown> = {}, id = 1) {
  const headers: Record<string, string> = { "mcp-protocol-version": MODERN, "mcp-method": method };
  if (typeof params.name === "string") headers["mcp-name"] = params.name;
  return rpc({ jsonrpc: "2.0", id, method, params: { ...params, _meta: modernMeta() } }, { headers });
}

export function initialize(protocolVersion: string) {
  return legacy("initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  });
}

/** Text of a tools/call result, whichever era answered. */
export function resultText(r: RpcResponse): string {
  return r.body.result.content[0].text;
}
