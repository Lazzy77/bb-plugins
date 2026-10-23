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
import {
  panesToClose,
  partnerFor,
  planFor,
  relativeVisible,
  visibleThreads,
  type LastChildren,
  type PairPane,
  type Plan,
} from "./lib/pairs";

const LAST_CHILDREN_KEY = "thread-pairs.lastChildren";
const HOST_MAXIMIZED_KEY = "bb.splitLayout.maximizedPaneId";
const STEP_TIMEOUT_MS = 1500;

type Step = [name: string, run: () => void, done: () => boolean];

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

/** Presses the pane's own close button; false when BB renders none. */
function clickClose(paneId: string): boolean {
  const pane = Array.from(document.querySelectorAll<HTMLElement>("[data-split-pane-id]")).find(
    (el) => el.dataset.splitPaneId === paneId,
  );
  const button = pane?.querySelector<HTMLButtonElement>('button[aria-label="Close pane"]');
  if (!button) return false;
  button.click();
  return true;
}

function PairKeeper() {
  const { threadId: routedThreadId } = useBbContext();
  const layout = useSidebarSplitLayout();
  const focusedPane = layout?.panes.find((p) => p.isFocused) ?? null;
  const threadId = focusedPane?.threadId ?? routedThreadId;
  const composing = focusedPane !== null && focusedPane.threadId === null && routedThreadId === null && window.location.pathname === "/";
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
  const knownThreads = useRef<Set<string> | null>(null);
  const wasComposing = useRef(false);
  const running = useRef(false);
  const latestPanes = useRef<readonly PairPane[] | null>(null);
  const latestThread = useRef<string | null>(null);
  latestPanes.current = layout ? layout.panes : null;
  latestThread.current = threadId;

  const waitFor = async (check: () => boolean): Promise<boolean> => {
    const deadline = Date.now() + STEP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (check()) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 16));
    }
    return check();
  };
  const focusedOn = (target: string) => () => latestThread.current === target;
  const paneAction = (target: string, action: "maximize" | "restore") =>
    sdk.threads.paneAction({ threadId: target, action }).catch((cause: unknown) => {
      trace("pane-action-failed", { action, cause: String(cause) });
    });

  /** Closes the given panes; a pane without a close button stays. */
  const closePanes = async (paneIds: readonly string[]): Promise<string[]> => {
    const closed: string[] = [];
    for (const paneId of paneIds) {
      if (!clickClose(paneId)) continue;
      if (!(await waitFor(() => !(latestPanes.current ?? []).some((p) => p.paneId === paneId)))) break;
      closed.push(paneId);
    }
    return closed;
  };

  const settle = () => {
    seen.current = visibleThreads(latestPanes.current, latestThread.current);
    focused.current = latestThread.current;
    running.current = false;
  };

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
    const known = knownThreads.current;
    seen.current = visible;
    focused.current = threadId;
    if (status === "ready") knownThreads.current = new Set(threads.map((t) => t.id));
    if (!threadId || previous === null || !visible.has(threadId)) return;
    const appeared = !previous.has(threadId);
    const childAppeared =
      status === "ready" && known !== null && threads.some((t) => t.parentThreadId === threadId && !t.isHidden && !known.has(t.id));
    if (!appeared && previousFocus === threadId && !childAppeared) return;
    if (status !== "ready" || !isAvailable || running.current) return;

    const partner = partnerFor(threadId, threads, readLastChildren());
    if (!appeared && (partner === null || relativeVisible(threadId, threads, visible))) return;
    const threadIsParent = partner !== null && threads.some((t) => t.id === partner && t.parentThreadId === threadId);
    const toClose = panesToClose(threadId, panes, partner);
    const plan = planFor(threadId, panes, partner, threadIsParent);
    const maximized = partner === null ? null : maximizedPaneId();
    const maximizedThread = maximized ? panes?.find((p) => p.paneId === maximized)?.threadId ?? null : null;
    if (toClose.length === 0 && plan.kind === "none" && !maximizedThread) return;
    trace("plan", { threadId, partner, toClose, plan, ...(childAppeared ? { childAppeared } : {}) });

    const stepsFor = (next: Plan): Step[] => {
      if (next.kind === "replace") {
        return next.partnerHere
          ? [
              ["open-partner", () => navigate.toThread(next.partner), focusedOn(next.partner)],
              ["focus-other", () => navigate.toThread(next.paneThreadId, { split: true }), focusedOn(next.paneThreadId)],
              ["open-thread", () => navigate.toThread(threadId), focusedOn(threadId)],
            ]
          : [
              ["focus-other", () => navigate.toThread(next.paneThreadId, { split: true }), focusedOn(next.paneThreadId)],
              ["open-partner", () => navigate.toThread(next.partner), focusedOn(next.partner)],
              ["focus-back", () => navigate.toThread(threadId, { split: true }), focusedOn(threadId)],
            ];
      }
      if (next.kind === "split") {
        return next.partnerHere
          ? [
              ["open-partner", () => navigate.toThread(next.partner), focusedOn(next.partner)],
              ["split-thread", () => navigate.toThread(threadId, { split: true }), focusedOn(threadId)],
            ]
          : [
              ["split-partner", () => navigate.toThread(next.partner, { split: true }), focusedOn(next.partner)],
              ["focus-back", () => navigate.toThread(threadId, { split: true }), focusedOn(threadId)],
            ];
      }
      return [];
    };
    running.current = true;
    void (async () => {
      try {
        if (maximizedThread) {
          await paneAction(maximizedThread, "restore");
          if (!(await waitFor(() => maximizedPaneId() === null))) {
            trace("step-timeout", { step: "restore", maximized });
            return;
          }
        }
        const closed = await closePanes(toClose);
        if (partner === null && closed.length < toClose.length) {
          trace("close-failed", { toClose, closed });
          await paneAction(threadId, "maximize");
          return;
        }
        const current = planFor(threadId, latestPanes.current, partner, threadIsParent);
        for (const [name, run, done] of stepsFor(current)) {
          run();
          if (!(await waitFor(done))) {
            trace("step-timeout", { step: name });
            return;
          }
        }
        const panesNow = [...(latestPanes.current ?? [])].sort((x, y) => x.rect.x - y.rect.x).map((p) => p.threadId);
        trace("done", { threadId, partner, closed, plan: current, panes: panesNow });
      } finally {
        settle();
      }
    })();
  }, [threadId, layout, status, threads, isAvailable, navigate, sdk, rpc]);

  useEffect(() => {
    const entered = composing && !wasComposing.current;
    wasComposing.current = composing;
    if (!entered || !layout || !focusedPane || running.current) return;
    const toClose = layout.panes.filter((p) => p.paneId !== focusedPane.paneId).map((p) => p.paneId);
    if (toClose.length === 0) return;
    trace("compose", { toClose });
    running.current = true;
    void (async () => {
      try {
        const closed = await closePanes(toClose);
        trace(closed.length === toClose.length ? "done" : "close-failed", { compose: true, toClose, closed });
      } finally {
        settle();
      }
    })();
  }, [composing, layout, focusedPane, sdk]);

  return null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "pair-keeper", component: PairKeeper });
});
