// Profile-driven device control.
//
// The ThinQ control endpoint wants `{ <resource>: { <property>: <value> } }`,
// e.g. `{"operation": {"airConOperationMode": "POWER_ON"}}`, and only accepts
// a value the device's profile marks writable. The Python server got both from
// the SDK's per-device-type classes (30 of them, one method per property). This
// module gets both from the profile itself, which is what those classes were
// generated from, so it covers every device type the SDK does without carrying
// a copy of each class.
//
// Profile shapes seen in the wild (SDK devices/*.py):
//
//   property: { resource: { prop: Spec } }                    most devices
//   property: { resource: [ { unit: "C", prop: Spec }, ... ] } per-unit variants (AC temperatureInUnits)
//   property: { resource: [ { locationName: "FRIDGE", ... } ] } per-compartment variants (refrigerator)
//   property: [ { location: { locationName: "MAIN" }, resource: {...} }, ... ]
//                                                              per-location blocks (washer, oven, cooktop)
//
// Spec: { type: "enum"|"range"|"number"|"boolean"|"string", mode: ["r","w"],
//         value: { r: ..., w: ... } }  where `w` is a list for enum/boolean
//         and { min, max, step, except? } for range.

export type Json = Record<string, any>;

export class ControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlError";
  }
}

// snake_case -> camelCase (profile keys are camelCase).
export function toCamel(s: string): string {
  return s.replace(/_([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
}

/** Parameters the caller may pass alongside property values. Never sent as properties. */
const SELECTOR_KEYS = new Set(["location", "locationName", "unit"]);

interface Candidate {
  /** Which resource the property sits under. */
  resource: string;
  /** Property key as it appears in the profile (camelCase). */
  key: string;
  spec: Json;
  /** Discriminators the chosen list entry carries, e.g. { unit: "C" } or { locationName: "FRIDGE" }. */
  entry: Record<string, string>;
  /** For per-location-block profiles, the block's locationName. */
  block: string | null;
}

function isSpec(v: unknown): v is Json {
  return !!v && typeof v === "object" && !Array.isArray(v) && Array.isArray((v as Json).mode);
}

function discriminators(entry: Json): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["unit", "locationName"]) if (typeof entry[k] === "string") out[k] = entry[k];
  return out;
}

/** Every (block, resource, entry, key, spec) tuple in the profile. */
function walk(profile: Json): Candidate[] {
  const out: Candidate[] = [];
  const property = profile?.property;
  const blocks: Array<{ name: string | null; resources: Json }> = [];
  if (Array.isArray(property)) {
    for (const b of property) {
      if (!b || typeof b !== "object") continue;
      const name = b.location?.locationName ?? b.locationName ?? null;
      const { location: _l, locationName: _n, ...resources } = b;
      blocks.push({ name: typeof name === "string" ? name : null, resources });
    }
  } else if (property && typeof property === "object") {
    blocks.push({ name: null, resources: property });
  }
  for (const block of blocks) {
    for (const [resource, body] of Object.entries(block.resources)) {
      const entries = Array.isArray(body) ? body : [body];
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const disc = Array.isArray(body) ? discriminators(entry) : {};
        for (const [key, spec] of Object.entries(entry)) {
          if (!isSpec(spec)) continue;
          out.push({ resource, key, spec, entry: disc, block: block.name });
        }
      }
    }
  }
  return out;
}

function writable(c: Candidate): boolean {
  return c.spec.mode.includes("w");
}

// --- guide ---------------------------------------------------------------------

export interface WritableProperty {
  resource: string;
  key: string;
  type: string;
  /** enum/boolean: the allowed values; range: {min,max,step}; number/string: null */
  accepts: unknown;
  /** Selectors the caller must pass with this key, e.g. { unit: "C" } or { location: "MAIN" }. */
  select: Record<string, string>;
}

/** The writable properties a caller may set, in profile order. */
export function writableProperties(profile: Json): WritableProperty[] {
  return walk(profile)
    .filter(writable)
    .map((c) => {
      const select: Record<string, string> = {};
      if (c.block !== null) select.location = c.block;
      if (c.entry.locationName !== undefined) select.location = c.entry.locationName;
      if (c.entry.unit !== undefined) select.unit = c.entry.unit;
      const w = c.spec.value?.w;
      let accepts: unknown = null;
      if (c.spec.type === "enum" || c.spec.type === "boolean") accepts = Array.isArray(w) ? w : null;
      else if (c.spec.type === "range") accepts = w ?? null;
      return { resource: c.resource, key: c.key, type: String(c.spec.type), accepts, select };
    });
}

// --- payload -----------------------------------------------------------------

function coerce(spec: Json, value: unknown): unknown {
  const t = spec.type;
  if ((t === "range" || t === "number") && typeof value === "string" && value.trim() !== "" && !isNaN(Number(value))) {
    return Number(value);
  }
  if (t === "boolean" && (value === "true" || value === "false")) return value === "true";
  return value;
}

function checkValue(c: Candidate, value: unknown): void {
  const { spec } = c;
  const label = c.resource + "." + c.key;
  const w = spec.value?.w;
  switch (spec.type) {
    case "enum": {
      if (!Array.isArray(w) || !w.includes(value)) {
        throw new ControlError("Not support " + label + " : " + JSON.stringify(value) + " (writable values: " + JSON.stringify(w ?? []) + ")");
      }
      return;
    }
    case "boolean": {
      if (typeof value !== "boolean" || (Array.isArray(w) && !w.includes(value))) {
        throw new ControlError("Not support " + label + " : " + JSON.stringify(value) + " (expected a boolean)");
      }
      return;
    }
    case "range": {
      if (typeof value !== "number" || !isFinite(value)) {
        throw new ControlError("Not support " + label + " : " + JSON.stringify(value) + " (expected a number)");
      }
      if (!w || typeof w !== "object") return;
      const min = Number(w.min), max = Number(w.max), step = w.step === undefined ? 1 : Number(w.step);
      const except: unknown[] = Array.isArray(w.except) ? w.except : [];
      const onStep = step > 0 ? Math.abs(((value - min) / step) - Math.round((value - min) / step)) < 1e-9 : true;
      if (value < min || value > max || !onStep || except.includes(value)) {
        throw new ControlError("Not support " + label + " : " + value + " (writable range: " + JSON.stringify(w) + ")");
      }
      return;
    }
    case "number": {
      if (typeof value !== "number" || !isFinite(value)) {
        throw new ControlError("Not support " + label + " : " + JSON.stringify(value) + " (expected a number)");
      }
      return;
    }
    default:
      return;
  }
}

function selectorsFrom(params: Json): { location: string | null; unit: string | null } {
  const loc = params.location ?? params.locationName ?? params.location_name;
  const unit = params.unit;
  return {
    location: typeof loc === "string" ? loc : null,
    unit: typeof unit === "string" ? unit.toUpperCase() : null,
  };
}

function describe(c: Candidate): string {
  const sel = { ...(c.block !== null ? { location: c.block } : {}), ...c.entry };
  return c.resource + "." + c.key + (Object.keys(sel).length ? " " + JSON.stringify(sel) : "");
}

/**
 * Resolve one caller key to exactly one writable profile property.
 *
 * Keys may be `property`, `resource.property`, snake_case or camelCase. Where
 * the same key is writable in more than one place, the caller narrows it with
 * `location`/`unit` selectors or the dotted form. Anything still ambiguous is
 * an error listing the options rather than a guess -- these are appliances.
 */
function resolve(all: Candidate[], rawKey: string, sel: { location: string | null; unit: string | null }): Candidate {
  const camel = toCamel(rawKey);
  const dot = camel.indexOf(".");
  const wantResource = dot === -1 ? null : camel.slice(0, dot);
  const wantKey = dot === -1 ? camel : camel.slice(dot + 1);

  let matches = all.filter((c) => c.key === wantKey && (wantResource === null || c.resource === wantResource));
  if (matches.length === 0) {
    throw new ControlError("Not support " + rawKey + ": no such property in the device profile");
  }
  const anyWritable = matches.filter(writable);
  if (anyWritable.length === 0) {
    throw new ControlError("Not support " + rawKey + ": property is read-only");
  }
  matches = anyWritable;

  if (sel.location !== null) {
    matches = matches.filter((c) => (c.block ?? c.entry.locationName ?? null) === null || (c.block ?? c.entry.locationName) === sel.location);
    if (matches.length === 0) throw new ControlError("Not support " + rawKey + " at location " + sel.location);
  }
  if (sel.unit !== null) {
    matches = matches.filter((c) => c.entry.unit === undefined || c.entry.unit === sel.unit);
    if (matches.length === 0) throw new ControlError("Not support " + rawKey + " in unit " + sel.unit);
  }
  if (matches.length === 1) return matches[0];

  // Several places accept this key. A selector the caller gave points at the
  // entries that carry it (unit: "C" means the per-unit list, as the SDK
  // sends); otherwise prefer the one that needs no selector at all.
  if (sel.unit !== null) {
    const withUnit = matches.filter((c) => c.entry.unit !== undefined);
    if (withUnit.length === 1) return withUnit[0];
  }
  if (sel.location !== null) {
    const withLoc = matches.filter((c) => c.entry.locationName !== undefined || c.block !== null);
    if (withLoc.length === 1) return withLoc[0];
  }
  const plain = matches.filter((c) => Object.keys(c.entry).length === 0 && c.block === null);
  if (plain.length === 1) return plain[0];

  throw new ControlError(
    "Ambiguous property " + rawKey + "; pass location/unit or use one of: " + matches.map(describe).join(", "),
  );
}

export interface ControlPlan {
  payload: Json;
  /** What was resolved, for the tool's reply. */
  applied: Array<{ resource: string; key: string; value: unknown }>;
}

/**
 * Turn `{ propertyName: value, ... }` into the control body the API expects,
 * validating every value against the profile. Throws ControlError on anything
 * the device would not accept, before any request is made.
 */
export function buildControlPayload(profile: Json, params: Json): ControlPlan {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new ControlError("control_params must be an object of property: value pairs");
  }
  const all = walk(profile);
  if (all.length === 0) throw new ControlError("Device profile has no properties");
  const sel = selectorsFrom(params);

  const payload: Json = {};
  const applied: ControlPlan["applied"] = [];
  let block: string | null = null;
  for (const [rawKey, rawValue] of Object.entries(params)) {
    if (SELECTOR_KEYS.has(rawKey) || rawKey === "location_name") continue;
    const c = resolve(all, rawKey, sel);
    const value = coerce(c.spec, rawValue);
    checkValue(c, value);

    if (c.block !== null) {
      if (block !== null && block !== c.block) {
        throw new ControlError("Properties span two locations (" + block + ", " + c.block + "); control one location per call");
      }
      block = c.block;
    }
    const target = (payload[c.resource] ??= {});
    for (const [dk, dv] of Object.entries(c.entry)) {
      if (target[dk] !== undefined && target[dk] !== dv) {
        throw new ControlError("Properties under " + c.resource + " disagree on " + dk + " (" + target[dk] + " vs " + dv + ")");
      }
      target[dk] = dv;
    }
    target[c.key] = value;
    applied.push({ resource: c.resource, key: c.key, value });
  }
  if (applied.length === 0) throw new ControlError("control_params has no property to set");
  if (block !== null) payload.location = { locationName: block };
  return { payload, applied };
}
