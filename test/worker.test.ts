import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../index";
import { env, IDENTITY, initialize, legacy, modern, resultText, rpc } from "./helpers";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf-8");

const AC_ID = "6a1388fa269bd466a61a85a6668274036989e8c423444d2d7fec8de298807a5a";

// --- a fake ThinQ API ------------------------------------------------------------
// Records every upstream call so a test can assert what would have reached LG.

interface Upstream {
  calls: Array<{ method: string; url: string; headers: Record<string, string>; body: any }>;
  /** Return a Response for a call, or throw to simulate a network failure. */
  answer: (call: Upstream["calls"][number]) => Response | Promise<Response>;
}

const thinqError = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

let upstream: Upstream;

beforeEach(() => {
  upstream = {
    calls: [],
    answer: (call) => {
      if (call.url.endsWith("/devices")) return Response.json({ response: JSON.parse(fixture("devices.json")) });
      if (call.url.endsWith("/profile")) return Response.json({ response: JSON.parse(fixture("profiles/device_air_conditioner.json")) });
      if (call.url.endsWith("/state")) return Response.json({ response: JSON.parse(fixture("device-status.json")) });
      if (call.url.endsWith("/control")) return Response.json({ response: {} });
      return new Response("not found", { status: 404 });
    },
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const call = { method: init?.method ?? "GET", url, headers, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    upstream.calls.push(call);
    return upstream.answer(call);
  });
});

afterEach(() => vi.unstubAllGlobals());

// --- identity gate ---------------------------------------------------------------

describe("identity gate", () => {
  it("refuses a request with no gateway identity, before routing", async () => {
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { identity: false });
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("no gateway identity");
    expect(upstream.calls).toHaveLength(0);
  });

  it("refuses a partial identity", async () => {
    const headers = { ...IDENTITY, "x-lost-plus-role": "" };
    const res = await worker.fetch(new Request("https://thinq.lost.plus/mcp", { method: "POST", headers }), env);
    expect(res.status).toBe(500);
  });

  it("refuses an identity without the encoding declaration", async () => {
    const { "x-lost-plus-encoding": _e, ...headers } = IDENTITY;
    const res = await worker.fetch(new Request("https://thinq.lost.plus/mcp", { headers }), env);
    expect(res.status).toBe(500);
  });

  it("does not validate any credential of its own: a bearer token changes nothing", async () => {
    const res = await worker.fetch(
      new Request("https://thinq.lost.plus/mcp", { headers: { authorization: "Bearer anything" } }),
      env,
    );
    expect(res.status).toBe(500);
  });
});

// --- routing ---------------------------------------------------------------------

describe("routing", () => {
  it("serves only /mcp: `/`, /healthz and /.well-known are the gateway's or nobody's", async () => {
    for (const path of ["/", "/healthz", "/.well-known/oauth-protected-resource", "/other"]) {
      const res = await worker.fetch(new Request("https://thinq.lost.plus" + path, { headers: IDENTITY }), env);
      expect(res.status, path).toBe(404);
    }
  });

  it("accepts POST /mcp/ (trailing slash) and /mcp/anything", async () => {
    for (const path of ["/mcp/", "/mcp/x"]) {
      const r = await legacy("ping", undefined, 1, { path });
      expect(r.status, path).toBe(200);
      expect(r.body.result).toEqual({});
    }
  });
});

// --- protocol eras ---------------------------------------------------------------

describe("MCP protocol eras", () => {
  it.each(["2025-06-18", "2025-03-26"])("initializes with a %s client", async (version) => {
    const r = await initialize(version);
    expect(r.status).toBe(200);
    expect(r.body.result.protocolVersion).toBe(version);
    expect(r.body.result.serverInfo.name).toBe("thinqconnect-mcp");
    expect(r.body.result.capabilities.tools).toBeDefined();
    expect(r.body.result.capabilities.prompts).toBeDefined();
  });

  it("lists four tools for a 2025-era client without cache fields", async () => {
    const r = await legacy("tools/list", {}, 2);
    expect(r.status).toBe(200);
    expect(r.body.result.tools.map((t: any) => t.name)).toEqual([
      "get_device_list",
      "get_device_available_controls",
      "post_device_control",
      "get_device_status",
    ]);
    expect(r.body.result.ttlMs).toBeUndefined();
  });

  it("lists the same four tools for a 2026-07-28 client with a 5-minute private cache hint", async () => {
    const r = await modern("tools/list");
    expect(r.status).toBe(200);
    expect(r.body.result.resultType).toBe("complete");
    expect(r.body.result.tools.map((t: any) => t.name)).toEqual([
      "get_device_list",
      "get_device_available_controls",
      "post_device_control",
      "get_device_status",
    ]);
    expect(r.body.result.ttlMs).toBe(300_000);
    expect(r.body.result.cacheScope).toBe("private");
  });

  it("answers server/discover for a 2026-07-28 client", async () => {
    const r = await modern("server/discover", { clientInfo: { name: "test", version: "0" } });
    expect(r.status).toBe(200);
    expect(r.body.result.supportedVersions).toEqual(["2026-07-28"]);
    expect(r.body.result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("thinqconnect-mcp");
    expect(r.body.result.ttlMs).toBe(300_000);
    expect(r.body.result.cacheScope).toBe("private");
  });

  it("lists the welcome prompt in both eras", async () => {
    const a = await legacy("prompts/list", {}, 3);
    const b = await modern("prompts/list");
    expect(a.body.result.prompts.map((p: any) => p.name)).toEqual(["welcome"]);
    expect(b.body.result.prompts.map((p: any) => p.name)).toEqual(["welcome"]);
    expect(b.body.result.ttlMs).toBe(300_000);
  });

  it("calls a tool in the 2026-07-28 era", async () => {
    const r = await modern("tools/call", { name: "get_device_list", arguments: {} });
    expect(r.status).toBe(200);
    expect(resultText(r)).toBe(fixture("expected/device-list.txt"));
  });
});

// --- tools: happy paths against the fake upstream ----------------------------------

describe("tools", () => {
  it("get_device_list sends the SDK's headers and formats the golden output", async () => {
    const r = await legacy("tools/call", { name: "get_device_list", arguments: {} });
    expect(resultText(r)).toBe(fixture("expected/device-list.txt"));
    const call = upstream.calls[0]!;
    expect(call.method).toBe("GET");
    expect(call.url).toBe("https://api-kic.lgthinq.com/devices");
    expect(call.headers.authorization).toBe("Bearer pat-under-test");
    expect(call.headers["x-country"]).toBe("KR");
    expect(call.headers["x-api-key"]).toMatch(/^[A-Za-z0-9]{40}$/);
    expect(call.headers["x-client-id"]).toBe("thinqconnect-mcp-client");
    expect(call.headers["x-service-phase"]).toBe("OP");
    expect(call.headers["x-message-id"]).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // Only control sends this, as in the SDK.
    expect(call.headers["x-conditional-control"]).toBeUndefined();
  });

  it("get_device_status formats the golden output", async () => {
    const r = await legacy("tools/call", { name: "get_device_status", arguments: { device_id: AC_ID } });
    expect(resultText(r)).toBe(fixture("expected/device-status.txt"));
    expect(upstream.calls[0]!.url).toBe("https://api-kic.lgthinq.com/devices/" + AC_ID + "/state");
  });

  it("get_device_available_controls lists writable properties with their accepted values", async () => {
    const r = await legacy("tools/call", {
      name: "get_device_available_controls",
      arguments: { device_type: "DEVICE_AIR_CONDITIONER", device_id: AC_ID },
    });
    const t = resultText(r);
    expect(t).toContain("# Device Control Instruction Guide");
    expect(t).toContain("- airConOperationMode [operation] enum [\"POWER_ON\",\"POWER_OFF\"]");
    expect(t).toContain("- coolTargetTemperature [temperatureInUnits] range {\"max\":30,\"min\":18,\"step\":1} (pass {\"unit\":\"C\"})");
    expect(t).not.toContain("- currentTemperature");
    expect(t).toContain("## Profile");
  });

  it("post_device_control nests the property under its resource and sends x-conditional-control", async () => {
    const r = await legacy("tools/call", {
      name: "post_device_control",
      arguments: { device_type: "DEVICE_AIR_CONDITIONER", device_id: AC_ID, control_method: "set_air_con_operation_mode", control_params: { air_con_operation_mode: "POWER_OFF" } },
    });
    expect(resultText(r)).toMatch(/^Device control completed\./);
    const control = upstream.calls.find((c) => c.url.endsWith("/control"))!;
    expect(control.method).toBe("POST");
    expect(control.headers["x-conditional-control"]).toBe("true");
    expect(control.headers["content-type"]).toBe("application/json");
    expect(control.body).toEqual({ operation: { airConOperationMode: "POWER_OFF" } });
  });

  it("post_device_control understands the Python server's call shape (set_<property> + one value)", async () => {
    const r = await legacy("tools/call", {
      name: "post_device_control",
      arguments: { device_id: AC_ID, control_method: "set_air_con_operation_mode", control_params: { operation: "POWER_OFF" } },
    });
    expect(resultText(r)).toMatch(/^Device control completed\./);
    expect(upstream.calls.find((c) => c.url.endsWith("/control"))!.body).toEqual({ operation: { airConOperationMode: "POWER_OFF" } });

    const r2 = await legacy("tools/call", {
      name: "post_device_control",
      arguments: { device_id: AC_ID, control_method: "set_cool_target_temperature_c", control_params: { temperature: 24 } },
    });
    expect(resultText(r2)).toMatch(/^Device control completed\./);
    expect(upstream.calls.filter((c) => c.url.endsWith("/control"))[1]!.body).toEqual({ temperatureInUnits: { unit: "C", coolTargetTemperature: 24 } });
  });

  it("post_device_control refuses a value outside the profile without contacting the device", async () => {
    const r = await legacy("tools/call", {
      name: "post_device_control",
      arguments: { device_id: AC_ID, control_method: "set_air_con_operation_mode", control_params: { air_con_operation_mode: "POWER_MAYBE" } },
    });
    expect(resultText(r)).toMatch(/^An error occurred during device control: ControlError: Not support operation\.airConOperationMode/);
    expect(upstream.calls.some((c) => c.url.endsWith("/control"))).toBe(false);
  });

  it("post_device_control refuses a property the device does not have (Python: Command not found)", async () => {
    const r = await legacy("tools/call", {
      name: "post_device_control",
      arguments: { device_id: AC_ID, control_method: "set_spin_speed", control_params: { spin_speed: "HIGH" } },
    });
    expect(resultText(r)).toContain("no such property");
    expect(upstream.calls.some((c) => c.url.endsWith("/control"))).toBe(false);
  });

  it("refuses a device_id that is not an id, before it reaches the URL path", async () => {
    const r = await legacy("tools/call", {
      name: "get_device_status",
      arguments: { device_id: "../../client/certificate" },
    });
    expect(r.body.result?.isError ?? r.body.error !== undefined).toBe(true);
    expect(upstream.calls).toHaveLength(0);
  });
});

// --- tools: upstream failures ---------------------------------------------------------
// The Python server surfaced the SDK's ThinQAPIException string, so a client
// could tell an offline device from a bad command. Same here.

describe("upstream failures", () => {
  const status = () => legacy("tools/call", { name: "get_device_status", arguments: { device_id: AC_ID } });

  it("device offline (1222)", async () => {
    upstream.answer = () => thinqError(400, "1222", "Not connected device");
    expect(resultText(await status())).toBe(
      "An error occurred while retrieving device status: ThinQAPIException: NOT_CONNECTED_DEVICE (1222) - Not connected device",
    );
  });

  it("command not supported while powered off (2304) on control", async () => {
    upstream.answer = (c) =>
      c.url.endsWith("/control")
        ? thinqError(400, "2304", "Command not supported in power off")
        : Response.json({ response: JSON.parse(fixture("profiles/device_air_conditioner.json")) });
    const r = await legacy("tools/call", {
      name: "post_device_control",
      arguments: { device_id: AC_ID, control_method: "set_wind_strength", control_params: { wind_strength: "HIGH" } },
    });
    expect(resultText(r)).toBe(
      "An error occurred during device control: ThinQAPIException: COMMAND_NOT_SUPPORTED_IN_POWER_OFF (2304) - Command not supported in power off, Command: set_wind_strength, Parameters: {\"wind_strength\":\"HIGH\"}",
    );
  });

  it("unknown error code", async () => {
    upstream.answer = () => thinqError(403, "9999", "??");
    expect(resultText(await status())).toContain("ThinQAPIException: UNKNOWN_ERROR (9999) - ??");
  });

  it("5xx without a ThinQ error body", async () => {
    upstream.answer = () => new Response("<html>bad gateway</html>", { status: 502 });
    expect(resultText(await status())).toBe(
      "An error occurred while retrieving device status: ThinQAPIException: UNKNOWN_ERROR (unknown error code) - HTTP 502",
    );
  });

  it("timeout", async () => {
    upstream.answer = () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    };
    expect(resultText(await status())).toBe(
      "An error occurred while retrieving device status: Error: ThinQ API timeout after 15s for devices/" + AC_ID + "/state",
    );
  });

  it("network failure", async () => {
    upstream.answer = () => {
      throw new TypeError("fetch failed");
    };
    expect(resultText(await status())).toBe("An error occurred while retrieving device status: TypeError: fetch failed");
  });

  it("an unsupported THINQ_COUNTRY is an error, not a silent fallback to Korea", async () => {
    const r = await rpc(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_device_list", arguments: {} } },
      { env: { THINQ_PAT: "x", THINQ_COUNTRY: "ZZ" } },
    );
    expect(resultText(r)).toBe("An error occurred while retrieving device list: Error: Not supported country_code: ZZ");
    expect(upstream.calls).toHaveLength(0);
  });
});
