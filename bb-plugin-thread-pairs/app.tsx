import { useEffect, useRef } from "react";
import {
  definePluginApp,
  experimental_useSidebarThreadSplit,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useRpc,
  useSdk,
  useSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { partnerFor, planFor, relativeVisible, visibleThreads, type LastChildren, type PairPane } from "./lib/pairs";

const LAST_CHILDREN_KEY = "thread-pairs.lastChildren";
const HOST_MAXIMIZED_KEY = "bb.splitLayout.maximizedPaneId";
const STEP_TIMEOUT_MS = 1500;

function readLastChildren(): LastChildren {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(LAST_CHILDREN_KEY) ?? "{}");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

function rememberChild(parentId: string, childId: string): void {
  const current = readLastChildren();
  if (current[parentId] === childId) return;
  try {
    window.localStorage.setItem(LAST_CHILDREN_KEY, JSON.stringify({ ...current, [parentId]: childId }));
  } catch {
    // Storage is full or blocked: the freshest child is used instead.
  }
}

function maximizedPaneId(): string | null {
  const read = (storage: Storage) => {
    try {
      return storage.getItem(HOST_MAXIMIZED_KEY);
    } catch {
      return null;
    }
  };
  const value = read(window.sessionStorage) ?? read(window.localStorage);
  return value ? value : null;
}

function PairKeeper() {
  const { threadId: routedThreadId } = useBbContext();
  const layout = useSidebarSplitLayout();
  const threadId = layout?.panes.find((p) => p.isFocused)?.threadId ?? routedThreadId;
  const { status, threads } = experimental_useSidebarThreads();
  const { isAvailable } = experimental_useSidebarThreadSplit(threadId ?? "");
  const navigate = useBbNavigate();
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const trace = (event: string, data?: Record<string, unknown>) => {
    rpc.call("trace", { event, data }).catch(() => {});
  };
  const seen = useRef<Set<string> | null>(null);
  const focused = useRef<string | null>(null);
  const running = useRef(false);
  const latestPanes = useRef<readonly PairPane[] | null>(null);
  latestPanes.current = layout ? layout.panes : null;

  const waitFor = async (check: (panes: readonly PairPane[] | null) => boolean): Promise<boolean> => {
    const deadline = Date.now() + STEP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (check(latestPanes.current)) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 16));
    }
    return check(latestPanes.current);
  };
  const focusedOn = (target: string) => (panes: readonly PairPane[] | null) =>
    panes?.some((p) => p.isFocused && p.threadId === target) ?? false;

  useEffect(() => {
    if (!threadId || status !== "ready") return;
    const parentId = threads.find((t) => t.id === threadId)?.parentThreadId;
    if (parentId && layout?.panes.some((p) => p.threadId === parentId)) rememberChild(parentId, threadId);
  }, [threadId, layout, status, threads]);

  useEffect(() => {
    const panes: PairPane[] | null = layout ? [...layout.panes] : null;
    const visible = visibleThreads(panes, threadId);
    const previous = seen.current;
    const previousFocus = focused.current;
    seen.current = visible;
    focused.current = threadId;
    if (!threadId || previous === null || !visible.has(threadId)) return;
    const appeared = !previous.has(threadId);
    if (!appeared && previousFocus === threadId) return;
    if (status !== "ready" || !isAvailable || running.current) return;

    const partner = partnerFor(threadId, threads, readLastChildren());
    if (!appeared && (partner === null || relativeVisible(threadId, threads, visible))) return;
    const plan = planFor(threadId, panes, partner);
    trace("plan", { threadId, partner, plan });
    const paneAction = (target: string, action: "maximize" | "restore") =>
      sdk.threads.paneAction({ threadId: target, action }).catch((cause: unknown) => {
        console.error(`thread-pairs: ${action} failed`, cause);
      });

    if (plan.kind === "maximize") {
      void paneAction(threadId, "maximize");
      return;
    }
    if (partner !== null) {
      const maximized = maximizedPaneId();
      const maximizedThread = maximized ? panes?.find((p) => p.paneId === maximized)?.threadId : null;
      trace("maximized", { maximized, maximizedThread: maximizedThread ?? null });
      if (maximizedThread) void paneAction(maximizedThread, "restore");
    }
    if (plan.kind === "none") return;

    running.current = true;
    const steps: [string, () => void, (panes: readonly PairPane[] | null) => boolean][] =
      plan.kind === "replace"
        ? [
            ["focus-other", () => navigate.toThread(plan.paneThreadId, { split: true }), focusedOn(plan.paneThreadId)],
            ["open-partner", () => navigate.toThread(plan.partner), focusedOn(plan.partner)],
            ["focus-back", () => navigate.toThread(threadId, { split: true }), focusedOn(threadId)],
          ]
        : [
            ["split-partner", () => navigate.toThread(plan.partner, { split: true }), focusedOn(plan.partner)],
            ["focus-back", () => navigate.toThread(threadId, { split: true }), focusedOn(threadId)],
          ];
    void (async () => {
      try {
        for (const [name, run, done] of steps) {
          run();
          if (!(await waitFor(done))) {
            trace("step-timeout", { step: name });
            return;
          }
        }
        trace("done", { threadId, partner: plan.partner });
      } finally {
        seen.current = visibleThreads(latestPanes.current, threadId);
        focused.current = threadId;
        running.current = false;
      }
    })();
  }, [threadId, layout, status, threads, isAvailable, navigate, sdk, rpc]);

  useEffect(() => {
    trace("mounted");
  }, []);

  return null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "pair-keeper", component: PairKeeper });
});
