![Local Image](https://www.lge.co.kr/kr/main/thinq/images/main/thinq_logo.png)

# ThinQ Connect MCP Server

An MCP server that lists, reads and controls LG ThinQ appliances through the
LG ThinQ Connect Open API. A Cloudflare Worker port of LG's
[thinqconnect-mcp](https://github.com/thinq-connect/thinqconnect-mcp), which
was a Python server built on the `thinqconnect` SDK.

Live at `https://thinq.lost.plus/mcp`.

## Where it runs and how it is reached

```
client ──bearer──▶ auth-gateway (Worker, holds thinq.lost.plus routes)
                       │  validates the token against auth.lost.plus (AUTH_HUB binding),
                       │  strips the credential, adds x-lost-plus-{sub,email,name,role,encoding}
                       ▼
                   THINQCONNECT service binding ──▶ this Worker (`thinqconnect`, no routes)
                                                        │
                                                        ▼
                                                 api-kic.lgthinq.com (THINQ_PAT)
```

- **Worker name:** `thinqconnect` (`wrangler.toml`). No `routes`, `workers_dev = false`.
  It is reachable only over the `THINQCONNECT` service binding declared in
  `auth/gateway/wrangler.toml`.
- **Gateway route:** `thinq.lost.plus` (no path prefix) with policy `mcp` and
  token scope `thinqconnect`, in `auth/gateway/config/cloudflare.gateway.json`.
  The gateway holds the zone routes for `/mcp`, `/mcp/*`, `/healthz` and
  `/.well-known/oauth-protected-resource*`, and answers the last two itself.
- **Authentication:** none here. The Worker reads the caller from the
  `x-lost-plus-*` headers with the shared
  [`@lpfchan/gateway-identity`](https://github.com/LPFchan/auth/tree/main/packages/gateway-identity)
  package and refuses, with a 500, any request that arrives without a
  complete one. It never sees a bearer token and never talks to
  `auth.lost.plus`.
- **Authorization:** the Common Auth hub's service registry marks
  `thinqconnect` as `admin_only`, so the hub refuses a non-administrator's
  token at admission and the gateway never forwards the request. That is
  what makes `post_device_control` (and every other tool here) admin-only.
  The Worker does not check `x-lost-plus-role` itself; if that registry flag
  is ever cleared, every admitted user can control the appliances.
- **State:** none. No D1, KV or R2. Each request builds a fresh MCP server; the
  only persistent thing is the `THINQ_PAT` secret.
- **Upstream:** the ThinQ Open API region host for `THINQ_COUNTRY`, with the
  SDK's headers and its 15 s timeout.

### Protocol

Both MCP eras are served from one tool definition (`createMcpHandler`):
2026-07-28 natively, with a 5-minute private cache hint on `tools/list`,
`prompts/list` and `server/discover`; 2025-era clients (`initialize` with
2025-06-18 or 2025-03-26) through the stateless fallback. `POST /mcp` and
`POST /mcp/` are equivalent.

## Tools

| Tool | What it does |
| --- | --- |
| `get_device_list` | All devices on the account: id, name, type, model. |
| `get_device_status` | Current state of one device, as JSON. |
| `get_device_available_controls` | The device's writable properties with their accepted values and any selector (`unit`, `location`) they need, followed by the raw profile. Read this before controlling. |
| `post_device_control` | Set one or more writable properties. `control_params` is `{ property: value }` (snake_case or camelCase), plus `unit`/`location` when the guide asks. Admin-only, enforced by the hub (see Authorization above). |

### How control works

The ThinQ control endpoint wants `{ <resource>: { <property>: <value> } }` and
only accepts values the device's profile marks writable. The Python server got
both from the SDK's per-device-type classes. This Worker gets both from the
profile itself (`control.ts`): it resolves each property to its resource, adds
the unit or location a variant needs, validates enum / range / boolean values,
and refuses anything the profile does not allow before any request is made.
That makes it independent of device type -- any appliance the Open API
describes can be controlled.

Examples of `control_params`:

```json
{ "air_con_operation_mode": "POWER_OFF" }
{ "cool_target_temperature": 24, "unit": "C" }
{ "relative_hour_to_start": 1, "relative_minute_to_start": 30 }
{ "washer_operation_mode": "START", "location": "MAIN" }
{ "timer.relative_hour_to_stop": 2 }
```

The Python-era shape `control_method: "set_air_con_operation_mode"` with
`control_params: { "operation": "POWER_OFF" }` is still understood: when the
params do not name a property, `set_<property>` is used as the property name
(a trailing `_c` / `_f` becomes the unit).

Errors keep the ThinQ code and name so a client can tell an offline appliance
(`NOT_CONNECTED_DEVICE (1222)`) from a command the current state does not
allow (`COMMAND_NOT_SUPPORTED_IN_POWER_OFF (2304)`).

## Deploy

```bash
npm install
npx wrangler secret put THINQ_PAT      # LG personal access token; a secret, never in git
npm run deploy                         # wrangler deploy
```

`npm run deploy` needs `CLOUDFLARE_API_TOKEN` in the environment; on the deploy
host it is exported from `~/.zshenv` with the value of passage `infra` /
`CF_MASTER_TOKEN`.

`THINQ_COUNTRY` is a plain var in `wrangler.toml` (default `KR`). The
`x-api-key` the Open API requires is a public constant from the LG SDK and is
hard-coded in `thinq.ts`; it is not a secret.

Do not add `routes` or `--route`: this Worker must stay route-less (see the
comment in `wrangler.toml`). Deploying only replaces this Worker's code; the
gateway keeps the routes.

**Roll back:** `git revert` the offending commit and deploy again, or
`npx wrangler rollback` to the previous version. There is no state to roll
back.

### Verify

```bash
TOK=...   # a Common Auth token with the thinqconnect scope
curl -s https://thinq.lost.plus/healthz                       # ok (gateway)
curl -s -X POST https://thinq.lost.plus/mcp -H "authorization: Bearer $TOK" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

A bogus or missing bearer gets a 401 with a `WWW-Authenticate` challenge from
the gateway; the Worker itself is never reached.

## Tests

```bash
npm test
```

- `test/logic.test.ts` -- output formatters against the golden files in
  `test/fixtures/expected/`, produced by the original Python server.
- `test/control.test.ts` -- payload building and validation against real
  device profiles in `test/fixtures/profiles/`.
- `test/thinq.test.ts` -- region table and the ThinQ error contract.
- `test/worker.test.ts` -- the Worker end to end with a fake upstream: identity
  gate, both protocol eras, every tool, and upstream failure shapes (offline,
  unsupported command, 4xx/5xx, timeout, network).

## Differences from the Python server

- `get_device_available_controls` lists writable properties from the profile
  instead of the SDK's Python method signatures.
- `post_device_control` is keyed by property, not by SDK method name (the old
  shape is accepted as described above).
- Whole-number floats render as `23`, not `23.0`; a device entry missing
  `deviceInfo` renders `undefined` instead of raising.
- The Python server cached the device list and profiles for the life of the
  process (a newly added device never appeared until restart). This Worker
  fetches them on every call.

## Getting a Personal Access Token

See the LG SDK's
[README](https://github.com/thinq-connect/pythinqconnect/blob/main/README.md#obtaining-and-using-a-personal-access-token)
for the token and the
[country code](https://github.com/thinq-connect/pythinqconnect/blob/main/README.md#country-codes).
