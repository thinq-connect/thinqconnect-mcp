import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { identityFrom } from "@lpfchan/gateway-identity";
import { buildControlPayload, ControlError, toCamel, writableProperties, type Json } from "./control";
import {
  getDeviceList,
  getDeviceProfile,
  getDeviceStatus,
  postDeviceControl,
  type ThinQEnv,
} from "./thinq";

// thinqconnect Worker: MCP server on Cloudflare Workers, a port of the Python
// thinqconnect-mcp (LG ThinQ Connect Open API).
//
// A route-less backend behind the gateway Worker. It authenticates nobody:
// the gateway has already asked auth.lost.plus who the caller is, and hands
// the answer over in x-lost-plus-* headers, read by the shared
// @lpfchan/gateway-identity parser. See the routes comment in wrangler.toml
// for why this Worker holds no route of its own.
//
// THINQ_PAT is this service's credential to LG, not a caller's credential to
// this service. It is a Worker secret.

export type Env = ThinQEnv;

export { messageId, thinqBaseUrl, unwrapThinqResponse } from "./thinq";

// --- output formatters --------------------------------------------------------
// These match the Python server's output byte for byte and are checked against
// the golden files in test/fixtures/expected/.

export function formatDeviceList(devices: unknown): string {
  const list = Array.isArray(devices) ? devices : [];
  const info = list.map((d: any) =>
    "Device ID: " + d.deviceId + "\n" +
    "Device Name: " + d.deviceInfo?.alias + "\n" +
    "Device Type: " + d.deviceInfo?.deviceType + "\n" +
    "Model Name: " + d.deviceInfo?.modelName + "\n"
  );
  return "Found " + list.length + " devices:\n\n" + info.join("\n");
}

export function formatDeviceStatus(status: unknown): string {
  return (
    "Device status information is as follows.\n" +
    "Please relay appropriately to the user.\n" +
    "## Status Information\n" +
    JSON.stringify(status, null, 2) +
    "\n"
  );
}

/** The control guide, built from the profile. Same sections as the Python server's, minus the SDK method list. */
export function formatControlGuide(deviceType: string | undefined, deviceId: string, profile: Json, now: Date = new Date()): string {
  const props = writableProperties(profile);
  const lines = props.map((p) => {
    const sel = Object.keys(p.select).length ? " (pass " + JSON.stringify(p.select) + ")" : "";
    const acc = p.accepts === null ? "" : " " + JSON.stringify(p.accepts);
    return "- " + p.key + " [" + p.resource + "] " + p.type + acc + sel;
  });
  const ts = now.toISOString().replace("T", " ").slice(0, 19);
  return [
    "# Device Control Instruction Guide",
    "Device: " + (deviceType ?? "unknown type") + " (" + deviceId + ")",
    "",
    "## Writable Properties",
    "Each line is `property [resource] type accepted-values (selectors)`. Only these may be set.",
    ...(lines.length ? lines : ["(none -- this device exposes no writable property)"]),
    "",
    "## Control Command Execution",
    "Call `post_device_control` with `control_params` as `{ \"<property>\": <value> }`; keys may be",
    "snake_case or camelCase. Set several properties of one resource in one call. Where a property",
    "lists a selector, include it too (e.g. `{ \"cool_target_temperature\": 24, \"unit\": \"C\" }`,",
    "`{ \"washer_operation_mode\": \"START\", \"location\": \"MAIN\" }`). If the same property name",
    "exists under two resources, write it as `resource.property`.",
    "",
    "### Value rules",
    "- enum / boolean: exactly one of the accepted values",
    "- range: number within min..max on the step, not in `except`",
    "- number: any number",
    "Values are checked against this profile before anything is sent; an invalid value is refused.",
    "",
    "### Time-based controls",
    "Current time (UTC): " + ts,
    "Relative timers take hours and minutes from now; if a requested clock time is already past, assume tomorrow.",
    "",
    "## Error Handling",
    "- COMMAND_NOT_SUPPORTED_IN_POWER_OFF (2304): turn the device on first",
    "- NOT_CONNECTED_DEVICE (1222): the appliance is offline; check `get_device_status`",
    "- Not support ...: the value or property is outside this profile",
    "",
    "## Profile",
    JSON.stringify(profile, null, 2),
  ].join("\n");
}

// --- Python-era call shape -----------------------------------------------------
// The Python server took `control_method: "set_<property>"` plus the method's
// own argument names (`{operation: "POWER_OFF"}`, `{temperature: 24}`), which
// say nothing about the property. When the params do not name a property but
// the method does, use the method: `set_air_con_operation_mode` + one value ->
// `{airConOperationMode: value}`; a trailing `_c`/`_f` becomes the unit.
export function legacyMethodParams(controlMethod: string | undefined, params: Json): Json | null {
  if (!controlMethod || !controlMethod.startsWith("set_")) return null;
  const values = Object.entries(params ?? {}).filter(([k]) => !["location", "location_name", "locationName", "unit"].includes(k));
  if (values.length !== 1) return null;
  let prop = controlMethod.slice(4);
  const out: Json = {};
  const m = /^(.*)_([cf])$/.exec(prop);
  if (m) {
    prop = m[1];
    out.unit = m[2].toUpperCase();
  }
  if (typeof params.location === "string") out.location = params.location;
  if (typeof params.unit === "string") out.unit = params.unit;
  out[toCamel(prop)] = values[0][1];
  return out;
}

// --- MCP server ---------------------------------------------------------------

function text(value: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: value }] };
}

const WELCOME_PROMPT = [
  "# Welcome to ThinQ Connect MCP Server",
  "",
  "Through the ThinQ Connect MCP server, you can manage and query ThinQ devices",
  "using natural language via the ThinQ Connect Open API platform.",
  "",
  "## Available Operations",
  "1. Device List Query — query all registered devices",
  "2. Device Information Query — query device status and available controls",
  "3. Device Control — turn devices on/off, change settings",
  "",
  "## Usage Examples:",
  "- Please provide a list of all devices",
  "- Please check the status of the robot vacuum device",
  "- Please set the temperature of the air conditioner device to 24 degrees",
].join("\n");

// ThinQ device ids are 64 hex chars. Anything outside this set is refused
// before it can reach the URL path.
const deviceId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "device_id must be the id from get_device_list").describe("Device ID from get_device_list");

export function buildServer(env: Env): McpServer {
  const server = new McpServer(
    { name: "thinqconnect-mcp", version: "0.3.0" },
    {
      // Five minutes, private: the tool list is the same for every caller
      // today, but it is served from behind a per-caller gateway.
      cacheHints: {
        "tools/list": { ttlMs: 300_000, cacheScope: "private" },
        "prompts/list": { ttlMs: 300_000, cacheScope: "private" },
        "server/discover": { ttlMs: 300_000, cacheScope: "private" },
      },
    },
  );

  server.registerTool(
    "get_device_list",
    {
      description: "Retrieves a list of all devices connected to the ThinQ Connect platform, with device ID, name, type, and model.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return text(formatDeviceList(await getDeviceList(env)));
      } catch (e) {
        return text("An error occurred while retrieving device list: " + String(e));
      }
    },
  );

  server.registerTool(
    "get_device_available_controls",
    {
      description: "Retrieves the writable properties and accepted values of a device, plus its full profile. Call this before post_device_control.",
      inputSchema: z.object({
        device_type: z.string().optional().describe("Device type from get_device_list, e.g. DEVICE_AIR_CONDITIONER"),
        device_id: deviceId,
      }),
    },
    async ({ device_type, device_id }) => {
      try {
        const profile = (await getDeviceProfile(env, device_id)) as Json;
        return text(formatControlGuide(device_type, device_id, profile));
      } catch (e) {
        return text("An error occurred while retrieving device details: " + String(e));
      }
    },
  );

  server.registerTool(
    "post_device_control",
    {
      description:
        "Sets one or more writable properties on a device. control_params is { property: value } using names from get_device_available_controls (snake_case or camelCase), plus `location`/`unit` selectors where that guide asks for them. Every value is validated against the device profile before the command is sent.",
      inputSchema: z.object({
        device_type: z.string().optional().describe("Device type from get_device_list"),
        device_id: deviceId,
        control_method: z.string().optional().describe("Optional label for the command, e.g. set_air_con_operation_mode. If control_params does not name a property, set_<property> is used as the property name."),
        control_params: z.record(z.string(), z.any()).describe("Property key/value pairs to set"),
      }),
    },
    async ({ device_id, control_method, control_params }) => {
      const label = (control_method ? "Command: " + control_method + ", " : "") + "Parameters: " + JSON.stringify(control_params);
      try {
        const profile = (await getDeviceProfile(env, device_id)) as Json;
        let plan;
        try {
          plan = buildControlPayload(profile, control_params);
        } catch (e) {
          const legacy = e instanceof ControlError ? legacyMethodParams(control_method, control_params) : null;
          if (legacy === null) throw e;
          plan = buildControlPayload(profile, legacy);
        }
        await postDeviceControl(env, device_id, plan.payload);
        return text(
          "Device control completed. Please relay appropriately to the user. " + label +
          ", Sent: " + JSON.stringify(plan.payload),
        );
      } catch (e) {
        return text("An error occurred during device control: " + String(e) + ", " + label);
      }
    },
  );

  server.registerTool(
    "get_device_status",
    {
      description: "Retrieves the current status of a specific device.",
      inputSchema: z.object({ device_id: deviceId }),
    },
    async ({ device_id }) => {
      try {
        return text(formatDeviceStatus(await getDeviceStatus(env, device_id)));
      } catch (e) {
        return text("An error occurred while retrieving device status: " + String(e));
      }
    },
  );

  server.registerPrompt(
    "welcome",
    { description: "I want to know how to use the ThinQ Connect MCP Server" },
    () => ({ messages: [{ role: "user", content: { type: "text", text: WELCOME_PROMPT } }] }),
  );

  return server;
}

// --- entry --------------------------------------------------------------------

/**
 * No identity headers, so no service.
 *
 * The only way to reach this Worker is through a service binding declared by
 * another Worker in the account, and the only Worker that declares one is the
 * gateway, which never forwards a request it has not authorized. So arriving
 * here without an identity means the deployment is wrong -- the gateway's
 * route for this host lost its `mcp` policy, or something else in the account
 * bound to this Worker directly.
 *
 * 500 rather than 401, because it is true. A 401 would tell the caller to
 * authenticate, and the caller may well have done so correctly; the fault is
 * on this side of the binding. Serving the tools anyway is the specific
 * failure the whole gateway arrangement exists to prevent, so this refuses.
 *
 * It matters more here than on the other MCP backends: these tools actuate
 * physical appliances, so an unauthenticated request that reached the tools
 * would not merely read data.
 */
function refused(): Response {
  return Response.json(
    { error: "no gateway identity", detail: "this service is only reachable through the gateway" },
    { status: 500 },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Before routing, not after. There is no path here that serves without an
    // identity, so there is no reason for one to be reachable before the check.
    if (identityFrom(request.headers) === null) return refused();

    const url = new URL(request.url);

    // Only /mcp. /healthz and /.well-known/oauth-protected-resource are the
    // gateway's, and `/` never arrives here because the gateway does not
    // route it.
    //
    // `/mcp/*` as well as `/mcp`. The gateway's route for this host has no
    // path_prefix, so both arrive here.
    if (url.pathname !== "/mcp" && !url.pathname.startsWith("/mcp/")) {
      return new Response("not found", { status: 404 });
    }

    // CORS is the gateway's: under the `mcp` policy it replaces whatever
    // access-control-* headers the backend returns with its own.
    //
    // Dual-era MCP: createMcpHandler serves 2026-07-28 (stateless, per
    // request) and falls back to stateless 2025-era serving for clients that
    // still send `initialize`. A fresh server per request; no session state.
    return createMcpHandler(() => buildServer(env)).fetch(request);
  },
};
