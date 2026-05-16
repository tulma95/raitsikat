import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMessage } from "./mqtt-client.ts";

const TOPIC = "/hfp/v2/journey/ongoing/vp/tram/40/123/1004/1/Eira/0700/3000/00/abc";
const vp = (over: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({
  VP: { desi: "4", oper: 40, veh: 123, lat: 60.17, long: 24.93, hdg: 90, ...over },
}));

describe("parseMessage", () => {
  it("maps HFP direction 1 to 1 and prefixes routeId with HSL:", () => {
    assert.deepEqual(parseMessage(TOPIC, vp(), 1000), {
      id: "40/123", line: "4", routeId: "HSL:1004", directionId: 1,
      lat: 60.17, lon: 24.93, heading: 90, updatedAt: 1000,
    });
  });

  it("maps HFP direction 2 to 2", () => {
    const t = TOPIC.replace("/1004/1/", "/1004/2/");
    assert.equal(parseMessage(t, vp(), 0)?.directionId, 2);
  });

  it("rejects route ids that do not start with a digit", () => {
    const t = TOPIC.replace("/1004/", "/X1004/");
    assert.equal(parseMessage(t, vp(), 0), null);
  });

  it("rejects directions other than 1 or 2", () => {
    const t = TOPIC.replace("/1004/1/", "/1004/3/");
    assert.equal(parseMessage(t, vp(), 0), null);
  });

  it("returns null when required VP fields are missing", () => {
    assert.equal(parseMessage(TOPIC, vp({ lat: undefined }), 0), null);
    assert.equal(parseMessage(TOPIC, vp({ desi: undefined }), 0), null);
    assert.equal(parseMessage(TOPIC, vp({ hdg: undefined }), 0), null);
  });

  it("returns null on invalid JSON payload", () => {
    assert.equal(parseMessage(TOPIC, Buffer.from("not json"), 0), null);
  });
});
