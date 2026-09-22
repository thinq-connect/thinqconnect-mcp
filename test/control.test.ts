import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildControlPayload, ControlError, toCamel, writableProperties } from "../control";

// Profiles captured from real appliances (GET /devices/{id}/profile). They
// carry no account or device identifiers.
const profile = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/profiles/${name}.json`, import.meta.url)), "utf-8"));

const ac = profile("device_air_conditioner");
const purifier = profile("device_air_purifier");
const washer = profile("device_washer");

describe("toCamel", () => {
  it("converts snake_case property names", () => {
    expect(toCamel("air_con_operation_mode")).toBe("airConOperationMode");
    expect(toCamel("cool_target_temperature")).toBe("coolTargetTemperature");
  });
  it("leaves camelCase untouched", () => {
    expect(toCamel("airConOperationMode")).toBe("airConOperationMode");
  });
  it("handles digits after the underscore", () => {
    expect(toCamel("pm_2_5")).toBe("pm25");
  });
  it("keeps a resource.property dotted form", () => {
    expect(toCamel("temperature.cool_target_temperature")).toBe("temperature.coolTargetTemperature");
  });
});

describe("buildControlPayload: payload shape", () => {
  it("nests the property under its resource, as the SDK does", () => {
    expect(buildControlPayload(ac, { air_con_operation_mode: "POWER_OFF" }).payload).toEqual({
      operation: { airConOperationMode: "POWER_OFF" },
    });
  });

  it("accepts camelCase keys", () => {
    expect(buildControlPayload(purifier, { currentJobMode: "SLEEP" }).payload).toEqual({
      airPurifierJobMode: { currentJobMode: "SLEEP" },
    });
  });

  it("merges several properties of one resource, as do_multi_attribute_command does", () => {
    expect(buildControlPayload(ac, { relative_hour_to_start: 1, relative_minute_to_start: 30, "timer.relative_start_timer": "UNSET" }).payload)
      .toEqual({ timer: { relativeHourToStart: 1, relativeMinuteToStart: 30, relativeStartTimer: "UNSET" } });
  });

  it("adds the unit for a per-unit list resource (AC temperatureInUnits)", () => {
    expect(buildControlPayload(ac, { "temperatureInUnits.coolTargetTemperature": 24, unit: "C" }).payload).toEqual({
      temperatureInUnits: { unit: "C", coolTargetTemperature: 24 },
    });
    expect(buildControlPayload(ac, { "temperatureInUnits.coolTargetTemperature": 70, unit: "f" }).payload).toEqual({
      temperatureInUnits: { unit: "F", coolTargetTemperature: 70 },
    });
  });

  it("prefers the plain resource when a key is writable both there and in a per-unit list", () => {
    // coolTargetTemperature is writable under both `temperature` (dict) and
    // `temperatureInUnits` (list). Without a unit, the dict wins.
    expect(buildControlPayload(ac, { cool_target_temperature: 24 }).payload).toEqual({
      temperature: { coolTargetTemperature: 24 },
    });
  });

  it("adds location for a per-location-block profile (washer)", () => {
    expect(buildControlPayload(washer, { washer_operation_mode: "START" }).payload).toEqual({
      location: { locationName: "MAIN" },
      operation: { washerOperationMode: "START" },
    });
    expect(buildControlPayload(washer, { washer_operation_mode: "STOP", location: "MAIN" }).payload).toEqual({
      location: { locationName: "MAIN" },
      operation: { washerOperationMode: "STOP" },
    });
  });

  it("reports what it resolved", () => {
    expect(buildControlPayload(ac, { wind_strength: "HIGH" }).applied).toEqual([
      { resource: "airFlow", key: "windStrength", value: "HIGH" },
    ]);
  });
});

describe("buildControlPayload: validation (mirrors the SDK's check_*_attribute_writable)", () => {
  const refuse = (p: any, params: any, re: RegExp) => {
    expect(() => buildControlPayload(p, params)).toThrow(ControlError);
    expect(() => buildControlPayload(p, params)).toThrow(re);
  };

  it("refuses an enum value outside the writable list", () => {
    refuse(ac, { air_con_operation_mode: "POWER_MAYBE" }, /Not support operation\.airConOperationMode : "POWER_MAYBE"/);
  });

  it("refuses a value that is readable but not writable (SDK: value in r, not in w)", () => {
    // relativeStartTimer reads SET|UNSET but only UNSET may be written.
    refuse(ac, { "timer.relative_start_timer": "SET" }, /Not support timer\.relativeStartTimer : "SET"/);
  });

  it("refuses a read-only property", () => {
    refuse(ac, { current_temperature: 20 }, /read-only/);
    refuse(washer, { remote_control_enabled: true }, /read-only/);
  });

  it("refuses a property the profile does not have", () => {
    refuse(ac, { spin_speed: "HIGH" }, /no such property/);
  });

  it("refuses a range value off the min/max/step", () => {
    refuse(ac, { cool_target_temperature: 17 }, /Not support temperature\.coolTargetTemperature : 17/);
    refuse(ac, { cool_target_temperature: 31 }, /Not support/);
    refuse(ac, { cool_target_temperature: 24.5 }, /Not support/);
    refuse(ac, { "temperatureInUnits.coolTargetTemperature": 65, unit: "F" }, /Not support/); // step 2 from 64
  });

  it("refuses a non-number for a range/number property", () => {
    refuse(ac, { cool_target_temperature: "warm" }, /expected a number/);
  });

  it("coerces numeric strings and 'true'/'false' the way the Python port cast by annotation", () => {
    expect(buildControlPayload(ac, { cool_target_temperature: "24" }).payload).toEqual({ temperature: { coolTargetTemperature: 24 } });
  });

  it("refuses a unit the device does not offer", () => {
    refuse(ac, { "temperatureInUnits.coolTargetTemperature": 24, unit: "K" }, /in unit K/);
  });

  it("refuses a location the device does not have", () => {
    refuse(washer, { washer_operation_mode: "START", location: "MINI" }, /at location MINI/);
  });

  it("refuses an empty or non-object params", () => {
    refuse(ac, {}, /no property to set/);
    refuse(ac, { unit: "C" }, /no property to set/);
    expect(() => buildControlPayload(ac, "POWER_OFF" as any)).toThrow(ControlError);
  });

  it("refuses a profile without properties", () => {
    refuse({ property: {} }, { x: 1 }, /no properties/);
    refuse({}, { x: 1 }, /no properties/);
  });
});

describe("writableProperties", () => {
  it("lists only writable properties, with selectors where the profile needs them", () => {
    const props = writableProperties(ac);
    const keys = props.map((p) => p.resource + "." + p.key + (p.select.unit ? "@" + p.select.unit : ""));
    expect(keys).toContain("operation.airConOperationMode");
    expect(keys).toContain("temperatureInUnits.coolTargetTemperature@C");
    expect(keys).toContain("temperatureInUnits.coolTargetTemperature@F");
    expect(keys).not.toContain("temperature.currentTemperature");
    expect(keys).not.toContain("runState.currentState");
    const op = props.find((p) => p.key === "airConOperationMode")!;
    expect(op.accepts).toEqual(["POWER_ON", "POWER_OFF"]);
    const cool = props.find((p) => p.resource === "temperature" && p.key === "coolTargetTemperature")!;
    expect(cool.accepts).toEqual({ max: 30, min: 18, step: 1 });
  });

  it("carries the block location for a per-location profile", () => {
    const props = writableProperties(washer);
    expect(props).toEqual([
      { resource: "operation", key: "washerOperationMode", type: "enum", accepts: ["START", "STOP", "POWER_OFF"], select: { location: "MAIN" } },
      { resource: "timer", key: "relativeHourToStop", type: "range", accepts: { except: [], max: 19, min: 3, step: 1 }, select: { location: "MAIN" } },
    ]);
  });
});
