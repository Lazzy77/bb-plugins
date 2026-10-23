import { test } from "node:test";
import assert from "node:assert/strict";
import { partnerFor, planFor, relativeVisible, visibleThreads, type PairPane, type PairThread } from "../lib/pairs.ts";

const t = (id: string, parentThreadId: string | null = null, updatedAt = 0, isHidden = false): PairThread =>
  ({ id, parentThreadId, updatedAt, isHidden });
const pane = (paneId: string, threadId: string | null, x: number, width = 0.5, isFocused = false): PairPane =>
  ({ paneId, threadId, isFocused, rect: { x, y: 0, width, height: 1 } });

test("a parent pairs with its most recently updated child", () => {
  const threads = [t("A"), t("A1", "A", 1), t("A2", "A", 5)];
  assert.equal(partnerFor("A", threads, {}), "A2");
});

test("a remembered child wins over a fresher one", () => {
  const threads = [t("A"), t("A1", "A", 1), t("A2", "A", 5)];
  assert.equal(partnerFor("A", threads, { A: "A1" }), "A1");
});

test("a remembered child that is gone falls back to the freshest", () => {
  const threads = [t("A"), t("A2", "A", 5)];
  assert.equal(partnerFor("A", threads, { A: "A1" }), "A2");
});

test("a child pairs with its parent", () => {
  assert.equal(partnerFor("A1", [t("A"), t("A1", "A")], {}), "A");
});

test("hidden threads never pair", () => {
  assert.equal(partnerFor("A", [t("A"), t("A1", "A", 0, true)], {}), null);
  assert.equal(partnerFor("A1", [t("A", null, 0, true), t("A1", "A")], {}), null);
});

test("an archived or unknown parent leaves the thread alone", () => {
  assert.equal(partnerFor("A1", [t("A1", "A")], {}), null);
});

test("a lone thread maximizes only over a split", () => {
  assert.deepEqual(planFor("C", null, null), { kind: "none" });
  assert.deepEqual(planFor("C", [pane("p1", "C", 0, 0.5, true), pane("p2", "B1", 0.5)], null), { kind: "maximize" });
});

test("a pair from a single pane splits", () => {
  assert.deepEqual(planFor("A", null, "A1"), { kind: "split", partner: "A1" });
});

test("a pair already on screen needs nothing", () => {
  assert.deepEqual(planFor("A", [pane("p1", "A", 0, 0.5, true), pane("p2", "A1", 0.5)], "A1"), { kind: "none" });
});

test("the other pane is replaced", () => {
  assert.deepEqual(
    planFor("A", [pane("p1", "A", 0, 0.5, true), pane("p2", "B1", 0.5)], "A1"),
    { kind: "replace", paneThreadId: "B1", partner: "A1" },
  );
});

test("with several panes the largest other one is replaced", () => {
  const panes = [pane("p1", "A", 0, 0.4, true), pane("p2", "X", 0.4, 0.2), pane("p3", "Y", 0.6, 0.4)];
  assert.deepEqual(planFor("A", panes, "A1"), { kind: "replace", paneThreadId: "Y", partner: "A1" });
});

test("panes without threads are never replaced", () => {
  assert.deepEqual(planFor("A", [pane("p1", "A", 0, 0.5, true), pane("p2", null, 0.5)], "A1"), { kind: "split", partner: "A1" });
});

test("visible threads come from panes, or from the route without a split", () => {
  assert.deepEqual([...visibleThreads(null, "A")], ["A"]);
  assert.deepEqual([...visibleThreads(null, null)], []);
  assert.deepEqual([...visibleThreads([pane("p1", "A", 0), pane("p2", null, 0.5)], "A")], ["A"]);
});

test("a relative on screen is either the parent or a child", () => {
  const threads = [t("A"), t("A1", "A"), t("B")];
  assert.equal(relativeVisible("A", threads, new Set(["A", "A1"])), true);
  assert.equal(relativeVisible("A1", threads, new Set(["A", "A1"])), true);
  assert.equal(relativeVisible("A", threads, new Set(["A", "B"])), false);
});
