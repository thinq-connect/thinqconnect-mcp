import { describe, expect, it } from "vitest";
import { ThinQApiError, THINQ_ERROR_NAMES, thinqErrorFrom, thinqRegion } from "../thinq";

describe("thinqRegion", () => {
  it("maps every country in the SDK table", () => {
    expect(thinqRegion("KR")).toBe("kic");
    expect(thinqRegion("US")).toBe("aic");
    expect(thinqRegion("DE")).toBe("eic");
    expect(thinqRegion(" kr ")).toBe("kic");
  });
  it("throws for a country the API does not serve", () => {
    expect(() => thinqRegion("AQ")).toThrow(/Not supported country_code/);
    expect(() => thinqRegion("")).toThrow(/Not supported country_code/);
  });
});

describe("ThinQApiError", () => {
  it("has the SDK's 60 error codes", () => {
    expect(Object.keys(THINQ_ERROR_NAMES)).toHaveLength(60);
    expect(THINQ_ERROR_NAMES["1222"]).toBe("NOT_CONNECTED_DEVICE");
    expect(THINQ_ERROR_NAMES["2304"]).toBe("COMMAND_NOT_SUPPORTED_IN_POWER_OFF");
  });

  it("stringifies like ThinQAPIException", () => {
    const e = new ThinQApiError(400, "1103", "Invalid token");
    expect(String(e)).toBe("ThinQAPIException: INVALID_TOKEN (1103) - Invalid token");
    expect(e.status).toBe(400);
    expect(e.errorName).toBe("INVALID_TOKEN");
  });

  it("reads the ThinQ error envelope", async () => {
    const e = await thinqErrorFrom(Response.json({ error: { code: "1205", message: "no such device" } }, { status: 404 }));
    expect(e.code).toBe("1205");
    expect(e.errorName).toBe("NOT_EXIST_DEVICE");
    expect(e.apiMessage).toBe("no such device");
  });

  it("survives a non-JSON or shapeless body", async () => {
    const a = await thinqErrorFrom(new Response("gateway timeout", { status: 504 }));
    expect(String(a)).toBe("ThinQAPIException: UNKNOWN_ERROR (unknown error code) - HTTP 504");
    const b = await thinqErrorFrom(Response.json({ message: "nope" }, { status: 500 }));
    expect(String(b)).toBe("ThinQAPIException: UNKNOWN_ERROR (unknown error code) - HTTP 500");
  });
});
