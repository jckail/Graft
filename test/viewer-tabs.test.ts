import { test } from "node:test";
import assert from "node:assert/strict";
import { createTabs, type Tab } from "../viewer/tabs.ts";

function fixture() {
  let focused: Tab | undefined;
  let panelLabel = "";
  const buttons = (["context", "code", "outline"] as Tab[]).map((tab) => ({
    tab, id: `tab-${tab}`, hidden: false, selected: false, tabIndex: -1,
    setHidden(hidden: boolean) { this.hidden = hidden; },
    setSelected(selected: boolean) { this.selected = selected; },
    setTabIndex(index: number) { this.tabIndex = index; },
    focus() { focused = this.tab; },
  }));
  const tabs = createTabs(buttons, (id) => { panelLabel = id; });
  return { buttons, tabs, focused: () => focused, label: () => panelLabel };
}

test("manual tab arrows wrap focus without changing the selected view or panel", () => {
  const f = fixture();
  f.tabs.configure();
  assert.equal(f.tabs.key("context", "ArrowLeft"), true);
  assert.equal(f.focused(), "outline");
  assert.equal(f.label(), "tab-context");
  assert.deepEqual(f.buttons.map((b) => b.selected), [true, false, false]);
  assert.deepEqual(f.buttons.map((b) => b.tabIndex), [-1, -1, 0]);
  f.tabs.key("outline", "ArrowRight");
  assert.equal(f.focused(), "context");
  f.tabs.key("context", "End");
  assert.equal(f.focused(), "outline");
  f.tabs.key("outline", "Home");
  assert.equal(f.focused(), "context");
});

test("native activation selects once; leaving the tablist restores its selected entry stop", () => {
  const f = fixture();
  f.tabs.configure();
  f.tabs.key("context", "ArrowRight");
  assert.equal(f.tabs.key("code", "Enter"), false);
  assert.equal(f.tabs.key("code", " "), false);
  // The native button click is the only activation path.
  f.tabs.select("code");
  assert.equal(f.label(), "tab-code");
  assert.deepEqual(f.buttons.map((b) => b.selected), [false, true, false]);
  f.tabs.key("code", "ArrowRight");
  f.tabs.resetTabStop();
  assert.deepEqual(f.buttons.map((b) => b.tabIndex), [-1, 0, -1]);
  for (const key of ["ArrowUp", "ArrowDown", "Tab", "Escape"]) assert.equal(f.tabs.key("code", key), false);
});

test("hidden tabs are skipped, exports honor default once, and later reloads retain user selection", () => {
  const f = fixture();
  assert.equal(f.tabs.configure(undefined, "code", true), "code");
  f.tabs.select("outline");
  assert.equal(f.tabs.configure(undefined, "code", false), "outline");
  assert.equal(f.tabs.configure(["context", "outline"]), "outline");
  f.tabs.key("context", "ArrowRight");
  assert.equal(f.focused(), "outline");
  assert.equal(f.buttons[1].hidden, true);
  assert.equal(f.tabs.key("code", "ArrowRight"), false);
  f.tabs.select("code");
  assert.equal(f.label(), "tab-outline");
  assert.equal(f.tabs.configure(["context"], undefined, false, "outline"), "context");
  assert.equal(f.focused(), "context");
  assert.deepEqual(f.buttons.map((b) => b.tabIndex), [0, -1, -1]);
  f.tabs.key("context", "ArrowRight");
  assert.equal(f.focused(), "context");
  f.tabs.configure();
  assert.deepEqual(f.buttons.map((b) => b.hidden), [false, false, false]);
});

test("an empty external tab list leaves a conservative usable Context tab", () => {
  const f = fixture();
  f.tabs.configure([], "code", true);
  assert.deepEqual(f.buttons.map((b) => b.hidden), [false, true, true]);
  assert.equal(f.label(), "tab-context");
});
