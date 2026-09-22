import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  formatDeviceList,
  formatDeviceStatus,
  messageId,
  thinqBaseUrl,
  unwrapThinqResponse,
} from "../index";

// Formatter parity with the retired Python server. The golden files under
// fixtures/expected/ were produced by its formatting module; the Worker's
// output is held to the same bytes.

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf-8");

const golden = (name: string) => fixture(`expected/${name}`);

describe("formatDeviceList", () => {
  it("matches the shared golden for a populated device list", () => {
    expect(formatDeviceList(JSON.parse(fixture("devices.json")))).toBe(
      golden("device-list.txt"),
    );
  });

  it("matches the shared golden for an empty device list", () => {
    expect(formatDeviceList(JSON.parse(fixture("devices-empty.json")))).toBe(
      golden("device-list-empty.txt"),
    );
  });

  it("treats a non-array payload as empty rather than throwing", () => {
    expect(formatDeviceList(null)).toBe("Found 0 devices:\n\n");
  });
});

describe("formatDeviceStatus", () => {
  it("matches the shared golden for a device status payload", () => {
    expect(formatDeviceStatus(JSON.parse(fixture("device-status.json")))).toBe(
      golden("device-status.txt"),
    );
  });

  it("keeps non-ASCII characters unescaped, as Python's ensure_ascii=False does", () => {
    expect(formatDeviceStatus({ alias: "거실 에어컨" })).toContain('"거실 에어컨"');
  });
});

// Where the Worker's output knowingly differs from the Python server's.
describe("known divergences from the Python server", () => {
  it("drops the decimal point on whole-number floats", () => {
    // Python emits 23.0 here; JSON.stringify emits 23.
    expect(formatDeviceStatus({ targetTemperature: 23.0 })).toContain(
      '"targetTemperature": 23',
    );
    expect(formatDeviceStatus({ targetTemperature: 23.0 })).not.toContain("23.0");
  });

  it("prints 'undefined' for a missing deviceInfo instead of raising", () => {
    // Python raises AttributeError, which its caller turns into an error string.
    expect(formatDeviceList([{ deviceId: "d1" }])).toContain("Device Name: undefined");
  });
});

describe("thinqBaseUrl", () => {
  it("maps known countries to their region host", () => {
    expect(thinqBaseUrl("KR")).toBe("https://api-kic.lgthinq.com");
    expect(thinqBaseUrl("US")).toBe("https://api-aic.lgthinq.com");
    expect(thinqBaseUrl("DE")).toBe("https://api-eic.lgthinq.com");
  });

  it("is case insensitive", () => {
    expect(thinqBaseUrl("kr")).toBe(thinqBaseUrl("KR"));
  });

  it("refuses an unsupported country, as the SDK does, instead of guessing a region", () => {
    expect(() => thinqBaseUrl("ZZ")).toThrow("Not supported country_code: ZZ");
  });

  it("covers the SDK's whole table, not a handful of countries", () => {
    expect(thinqBaseUrl("VN")).toBe("https://api-kic.lgthinq.com");
    expect(thinqBaseUrl("BR")).toBe("https://api-aic.lgthinq.com");
    expect(thinqBaseUrl("ZA")).toBe("https://api-eic.lgthinq.com");
  });
});

describe("unwrapThinqResponse", () => {
  it("unwraps the { response: ... } envelope", () => {
    expect(unwrapThinqResponse({ response: { a: 1 } })).toEqual({ a: 1 });
  });

  it("passes through a bare body", () => {
    expect(unwrapThinqResponse({ a: 1 })).toEqual({ a: 1 });
  });

  it("passes through null", () => {
    expect(unwrapThinqResponse(null)).toBeNull();
  });
});

describe("messageId", () => {
  it("is url-safe base64 of 16 bytes with padding stripped", () => {
    const id = messageId();
    expect(id).toHaveLength(22);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("is not constant", () => {
    expect(messageId()).not.toBe(messageId());
  });
});
