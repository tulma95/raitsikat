import { it } from "node:test";
import assert from "node:assert/strict";
import { startDepartureRefresh } from "./departure-refresh.ts";
import type { Departure } from "./types.ts";

it("refreshes predictions every 30 seconds and countdowns between requests", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  const rendered: number[] = [];
  const stop = startDepartureRefresh({
    load: async () => [{ line: "4", departureAt: ++calls * 60_000 }],
    render: (rows) => rendered.push(rows[0].departureAt),
    error: () => assert.fail("unexpected error"),
  });
  t.after(stop);
  await Promise.resolve();
  assert.deepEqual(rendered, [60_000]);
  t.mock.timers.tick(1_000);
  assert.deepEqual(rendered, [60_000, 60_000]);
  assert.equal(calls, 1);
  t.mock.timers.tick(29_000);
  await Promise.resolve();
  assert.equal(calls, 2);
  assert.equal(rendered.at(-1), 120_000);
  stop();
  const count = rendered.length;
  t.mock.timers.tick(60_000);
  assert.equal(calls, 2);
  assert.equal(rendered.length, count);
});

it("does not overlap requests and ignores responses arriving after close", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  let signal: AbortSignal | undefined;
  let resolve!: (rows: Departure[]) => void;
  const stop = startDepartureRefresh({
    load: (requestSignal) => {
      calls++;
      signal = requestSignal;
      return new Promise((done) => { resolve = done; });
    },
    render: () => assert.fail("closed popup must not render"),
    error: () => assert.fail("closed popup must not show an error"),
  });
  t.after(stop);
  t.mock.timers.tick(60_000);
  assert.equal(calls, 1);
  stop();
  assert.equal(signal?.aborted, true);
  resolve([{ line: "4", departureAt: 60_000 }]);
  await Promise.resolve();
});

it("retries after a failed request and resumes rendering", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  let errors = 0;
  const rendered: Departure[][] = [];
  const stop = startDepartureRefresh({
    load: async () => {
      if (++calls === 1) throw new Error("offline");
      return [];
    },
    render: (rows) => rendered.push(rows),
    error: () => errors++,
  });
  t.after(stop);
  await Promise.resolve();
  assert.equal(errors, 1);
  t.mock.timers.tick(1_000);
  assert.deepEqual(rendered, []);
  t.mock.timers.tick(29_000);
  await Promise.resolve();
  assert.deepEqual(rendered, [[]]);
  assert.equal(calls, 2);
});
