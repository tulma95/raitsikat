import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodePolyline, formatDeparture, escapeAttr } from "./pure.ts";

describe("decodePolyline", () => {
  it("matches Google's reference fixture", () => {
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    const rounded = pts.map(p => p.map(n => +n.toFixed(5)));
    assert.deepEqual(rounded, [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  });
});

describe("formatDeparture", () => {
  it("returns em-dash when more than 30s in the past", () => {
    assert.equal(formatDeparture(0, 60_000), "—");
  });
  it("returns 'now' near zero", () => {
    assert.equal(formatDeparture(0, 0), "now");
  });
  it("rounds future to minutes", () => {
    assert.equal(formatDeparture(120_000, 0), "in 2 min");
  });
});

describe("escapeAttr", () => {
  it("escapes the five HTML attribute reserved chars", () => {
    assert.equal(escapeAttr(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
  });
});
