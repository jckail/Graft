import { test } from "node:test";
import assert from "node:assert/strict";

// Separate module instances model inline and served pages without leaking globals.
let instance = 0;
const data = () => import(new URL(`../viewer/data.ts?test=${instance++}`, import.meta.url).href);
const fixture = { meta: { nodeCount: 1, edgeCount: 0 }, nodes: [{ id: "n", name: "N", type: "system", summary: "", sources: [] }], edges: [] };

test("served loader checks HTTP, preserves Code404, and reports JSON/transport failure", async (t) => {
  const original = globalThis.fetch;
  try {
    const module = await data();
    await t.test("Context success", async () => {
      globalThis.fetch = async (url) => { assert.equal(url, "/api/context-graph"); return Response.json(fixture); };
      assert.deepEqual(await module.loadContextGraph(), fixture);
    });
    await t.test("non-OK status rejects before parsing either response", async () => {
      globalThis.fetch = async () => new Response("not json", { status: 503 });
      await assert.rejects(module.loadContextGraph(), /Context graph request failed \(503\)/);
      await assert.rejects(module.loadCodeGraph(), /Code graph request failed \(503\)/);
    });
    await t.test("expected404 returns null without parsing the body", async () => {
      globalThis.fetch = async () => new Response("not json", { status: 404 });
      assert.equal(await module.loadCodeGraph(), null);
    });
    await t.test("bad JSON and transport errors reject", async () => {
      globalThis.fetch = async () => new Response("not json", { status: 200 });
      await assert.rejects(module.loadContextGraph(), SyntaxError);
      await assert.rejects(module.loadCodeGraph(), SyntaxError);
      globalThis.fetch = async () => { throw new Error("offline"); };
      await assert.rejects(module.loadContextGraph(), /offline/);
      await assert.rejects(module.loadCodeGraph(), /offline/);
    });
    await t.test("Code transforms nodes and filters unresolved edges", async () => {
      globalThis.fetch = async () => Response.json({
        meta: { version: 1, nodeCount: 1, edgeCount: 2 },
        nodes: [{ id: "f", name: "file", kind: "file", path: "demo.ts", span: "L1", signature: "sig", summary: null, crux: null }],
        edges: [{ source: "f", target: "f", relation: "contains", confidence: "extracted" },
          { source: "f", target: "missing", relation: "imports", confidence: "inferred" }],
      });
      const graph = await module.loadCodeGraph();
      assert.equal(graph.nodes[0].summary, "sig");
      assert.deepEqual(graph.nodes[0].sources, ["demo.ts · L1"]);
      assert.equal(graph.edges.length, 1);
      assert.equal(graph.meta.edgeCount, 1);
    });
  } finally { globalThis.fetch = original; }
});

test("inline export uses its local payload without fetch or an EventSource connection", async () => {
  const globals = globalThis as typeof globalThis & { __GRAFT_DATA__?: unknown };
  const originalData = globals.__GRAFT_DATA__;
  const originalFetch = globalThis.fetch;
  const originalSource = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
  let fetches = 0;
  let subscriptions = 0;
  try {
    globals.__GRAFT_DATA__ = { contextGraph: fixture, codeGraph: null };
    globalThis.fetch = async () => { fetches++; throw new Error("inline page must not fetch"); };
    Object.defineProperty(globalThis, "EventSource", { configurable: true, value: class { constructor() { subscriptions++; } } });
    const module = await data();
    assert.deepEqual(await module.loadContextGraph(), fixture);
    assert.equal(await module.loadCodeGraph(), null);
    module.onServerChange(() => assert.fail("inline page must not subscribe"));
    assert.equal(fetches, 0);
    assert.equal(subscriptions, 0);
  } finally {
    if (originalData === undefined) delete globals.__GRAFT_DATA__; else globals.__GRAFT_DATA__ = originalData;
    globalThis.fetch = originalFetch;
    if (originalSource) Object.defineProperty(globalThis, "EventSource", originalSource); else Reflect.deleteProperty(globalThis, "EventSource");
  }
});
