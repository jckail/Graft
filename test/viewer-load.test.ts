import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoader, loadPair } from "../viewer/load.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("pair failure waits for its outstanding peer and never returns a partial graph", async () => {
  const left = deferred<string>();
  const right = deferred<string>();
  let settled = false;
  const pair = loadPair(() => left.promise, () => right.promise).finally(() => { settled = true; });
  left.reject(new Error("network"));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  right.resolve("code");
  await assert.rejects(pair, /network/);
  assert.deepEqual(await loadPair(async () => "context", async () => null), { context: "context", code: null });
});

test("initial failure, retry success and later failure keep explicit outcome and last-good state", async () => {
  let fail = true;
  let rendered: string | undefined;
  let busy = false;
  let retainedAtError: string | undefined;
  const phases: boolean[] = [];
  const loader = createLoader({
    async load() { if (fail) throw new Error("unavailable"); return "loaded-graph"; },
    apply(value: string) { rendered = value; },
    loading(retained) { busy = true; phases.push(retained); },
    failed(_error, lastGood) { retainedAtError = lastGood; },
    settled() { busy = false; },
  });
  assert.equal(await loader.request("initial"), "failed");
  assert.equal(rendered, undefined);
  assert.equal(retainedAtError, undefined);
  assert.equal(busy, false);
  fail = false;
  assert.equal(await loader.request("retry"), "loaded");
  fail = true;
  assert.equal(await loader.request("change"), "failed");
  assert.equal(rendered, "loaded-graph");
  assert.equal(retainedAtError, "loaded-graph");
  assert.deepEqual(phases, [false, false, true]);
  assert.equal(busy, false);
});

test("burst server changes coalesce once and Retry cannot overlap an active request", async () => {
  const first = deferred<number>();
  const second = deferred<number>();
  const startedSecond = deferred<void>();
  let calls = 0;
  let inFlight = 0;
  let peak = 0;
  const values: number[] = [];
  const loader = createLoader({
    async load() {
      calls++; inFlight++; peak = Math.max(peak, inFlight);
      if (calls === 2) startedSecond.resolve();
      const value = await (calls === 1 ? first.promise : second.promise);
      inFlight--;
      return value;
    },
    apply(value: number) { values.push(value); },
    loading() {}, failed() { assert.fail("unexpected failure"); }, settled() {},
  });
  const active = loader.request("initial");
  await Promise.resolve();
  assert.equal(loader.request("retry"), active);
  for (let i = 0; i < 12; i++) assert.equal(loader.request("change"), active);
  first.resolve(1);
  await startedSecond.promise;
  assert.equal(calls, 2);
  assert.equal(peak, 1);
  second.resolve(2);
  assert.equal(await active, "loaded");
  assert.deepEqual(values, [1, 2]);
  assert.equal(inFlight, 0);
});

test("a failed apply does not become last-good and callback rejection remains observable", async () => {
  let value = 1;
  let lastGood: number | undefined;
  const loader = createLoader({
    async load() { return value; },
    apply(next: number) { if (next === 2) throw new Error("render failed"); },
    loading() {},
    failed(_error, retained) { lastGood = retained; }, settled() {},
  });
  assert.equal(await loader.request("initial"), "loaded");
  value = 2;
  assert.equal(await loader.request("change"), "failed");
  assert.equal(lastGood, 1);
  const broken = createLoader({
    async load() { throw new Error("load"); }, apply() {}, loading() {},
    failed() { throw new Error("callback"); }, settled() {},
  });
  await assert.rejects(broken.request("initial"), /callback/);
});
