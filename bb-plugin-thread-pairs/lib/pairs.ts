export interface PairThread {
  id: string;
  parentThreadId: string | null;
  updatedAt: number;
  isHidden: boolean;
}

export interface PairPane {
  paneId: string;
  threadId: string | null;
  isFocused: boolean;
  rect: { x: number; y: number; width: number; height: number };
}

export type LastChildren = Readonly<Record<string, string>>;

export type Plan =
  | { kind: "none" }
  | { kind: "maximize" }
  | { kind: "split"; partner: string; partnerHere: boolean }
  | { kind: "replace"; paneThreadId: string; partner: string; partnerHere: boolean };

/**
 * The thread shown beside `threadId`: its remembered or most recently updated
 * child, otherwise its parent, otherwise none.
 */
export function partnerFor(
  threadId: string,
  threads: readonly PairThread[],
  lastChildren: LastChildren,
): string | null {
  const children = threads.filter((t) => t.parentThreadId === threadId && !t.isHidden && t.id !== threadId);
  if (children.length > 0) {
    const remembered = lastChildren[threadId];
    if (remembered && children.some((c) => c.id === remembered)) return remembered;
    return children.reduce((best, c) => (c.updatedAt > best.updatedAt ? c : best)).id;
  }
  const self = threads.find((t) => t.id === threadId);
  const parentId = self?.parentThreadId ?? null;
  if (parentId === null || parentId === threadId) return null;
  const parent = threads.find((t) => t.id === parentId);
  return parent && !parent.isHidden ? parent.id : null;
}

/**
 * What to do once `threadId` has just appeared in the focused pane. The parent
 * always ends up left of its child: `partnerHere` means the partner takes the
 * focused pane and the thread moves to the other one.
 */
export function planFor(
  threadId: string,
  panes: readonly PairPane[] | null,
  partner: string | null,
  threadIsParent: boolean,
): Plan {
  if (partner === null) return panes !== null && panes.length >= 2 ? { kind: "maximize" } : { kind: "none" };
  if (panes === null) return { kind: "split", partner, partnerHere: !threadIsParent };
  if (panes.some((p) => p.threadId === partner)) return { kind: "none" };
  const others = panes.filter((p) => p.threadId !== null && p.threadId !== threadId);
  if (others.length === 0) return { kind: "split", partner, partnerHere: !threadIsParent };
  const target = others.reduce((best, p) => {
    const area = p.rect.width * p.rect.height;
    const bestArea = best.rect.width * best.rect.height;
    if (area !== bestArea) return area > bestArea ? p : best;
    return p.rect.x > best.rect.x ? p : best;
  });
  const here = panes.find((p) => p.threadId === threadId);
  const hereFirst = !here || here.rect.x < target.rect.x || (here.rect.x === target.rect.x && here.rect.y <= target.rect.y);
  return { kind: "replace", paneThreadId: target.threadId!, partner, partnerHere: hereFirst !== threadIsParent };
}

/** Thread ids on screen: every pane's thread, or the routed thread without a split. */
export function visibleThreads(panes: readonly PairPane[] | null, routedThreadId: string | null): Set<string> {
  if (panes === null) return new Set(routedThreadId ? [routedThreadId] : []);
  return new Set(panes.flatMap((p) => (p.threadId ? [p.threadId] : [])));
}

/** Whether the thread's parent or one of its children is on screen. */
export function relativeVisible(threadId: string, threads: readonly PairThread[], visible: ReadonlySet<string>): boolean {
  const parentId = threads.find((t) => t.id === threadId)?.parentThreadId ?? null;
  if (parentId !== null && visible.has(parentId)) return true;
  return threads.some((t) => t.parentThreadId === threadId && visible.has(t.id));
}
