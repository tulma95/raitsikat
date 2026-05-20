import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCoalescer, startRefillScheduler } from "./cache-helpers.ts";
import { logger } from "./logger.ts";

describe("createCoalescer", () => {
  it("collapses concurrent same-key calls into one factory invocation", async () => {
    const c = createCoalescer<string, number>();
    let calls = 0;
    const factory = async () => {
      calls++;
      await new Promise(r => setTimeout(r, 10));
      return 42;
    };
    const results = await Promise.all([
      c.run("k", factory), c.run("k", factory), c.run("k", factory),
    ]);
    assert.deepEqual(results, [42, 42, 42]);
    assert.equal(calls, 1);
  });

  it("releases the key after rejection so next call retries", async () => {
    const c = createCoalescer<string, number>();
    await assert.rejects(c.run("k", async () => { throw new Error("boom"); }));
    let called = false;
    const out = await c.run("k", async () => { called = true; return 7; });
    assert.equal(called, true);
    assert.equal(out, 7);
  });
});

describe("startRefillScheduler", () => {
  it("throws at construction when intervalMs >= gateMs (freeze guard)", () => {
    assert.throws(() => startRefillScheduler({
      intervalMs: 1000, gateMs: 1000, label: "x", logger, refill: async () => true,
    }), /must be </);
  });
});
