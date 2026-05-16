import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createState } from "./state.ts";
import type { Vehicle } from "./types.ts";

const v = (over: Partial<Vehicle>): Vehicle => ({
  id: "x", line: "4", routeId: "HSL:1004", directionId: 1,
  lat: 0, lon: 0, heading: 0, updatedAt: 0, ...over,
});

describe("state", () => {
  it("evict emits remove for stale vehicles and keeps fresh ones", () => {
    let t = 0;
    const s = createState({ evictAfterMs: 1000, now: () => t });
    const removed: string[] = [];
    s.on("remove", (id: string) => removed.push(id));
    s.upsert(v({ id: "a", updatedAt: 0 }));
    s.upsert(v({ id: "b", updatedAt: 500 }));
    t = 1200;
    s.evict();
    assert.deepEqual(removed, ["a"]);
    assert.deepEqual(s.snapshot().map(x => x.id), ["b"]);
  });

  it("remove of unknown id does not emit (prevents SSE noise)", () => {
    const s = createState({ evictAfterMs: 1000 });
    let n = 0;
    s.on("remove", () => n++);
    s.remove("ghost");
    assert.equal(n, 0);
  });

  it("upsert emits update with the vehicle payload", () => {
    const s = createState({ evictAfterMs: 1000 });
    const got: Vehicle[] = [];
    s.on("update", (veh: Vehicle) => { got.push(veh); });
    s.upsert(v({ id: "a" }));
    assert.equal(got[0]?.id, "a");
  });
});
