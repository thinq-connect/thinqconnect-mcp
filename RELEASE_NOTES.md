# Release Notes

## 0.3.0 (2026-09-19) -- Cloudflare Worker behind the gateway

- Runs as the route-less Worker `thinqconnect`, reached only through the
  `auth-gateway` Worker's `THINQCONNECT` service binding. No credential
  validation here; identity comes from `x-lost-plus-*` headers.
- Serves MCP 2026-07-28 with cache hints and 2025-era clients through the
  stateless fallback.
- `post_device_control` builds the `{resource: {property: value}}` body from
  the device profile and validates values before sending. Earlier Worker
  builds sent a flat body the API does not accept.
- ThinQ error codes and names are surfaced instead of a bare HTTP status.
- The Python server and its container tooling are removed from the repo, as
  is the upstream `demo.gif` (10 MB) and the identity-gated `GET /` document
  the gateway never routed. Identity headers are parsed by the shared
  `@lpfchan/gateway-identity` package.

## 0.0.5 (2025-08-05)
### Updates
- Updated dependencies to latest versions
- Pinned dependency versions for consistency
- Removed unused MCP_DESCRIPTION constant

## 0.0.1 (2025-07-02)
### Initial Release (Beta)
