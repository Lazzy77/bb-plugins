# Thread Pairs

A BB plugin that opens a thread together with its subthread, without reloading
the window.

- Open a thread that has subthreads: its subthread appears in the other pane.
  With several subthreads, the one you last focused next to it wins, otherwise
  the most recently updated one.
- Open a subthread: its parent appears in the other pane.
- Open a thread with neither: it is maximized; the other panes stay hidden
  until you open a pair again.
- The parent always ends up on the left and the subthread on the right,
  whichever pane had focus; focus stays on the thread you opened.

A thread that newly appears on screen triggers the plugin. Focusing a thread
that is already open triggers it only when neither its parent nor any of its
children is on screen, so moving focus within a pair changes nothing. Only a
newly opened lone thread is maximized.

Every decision is traced to the plugin log (`bb plugin logs thread-pairs`).

## How it works

`app.tsx` mounts an invisible overlay that watches the split layout
(`useSidebarSplitLayout`) and the routed thread. When a thread lands in the
focused pane, it focuses the other pane, replaces its thread with the partner
and focuses back, all through `useBbNavigate().toThread`. When the thread landed
on the wrong side, the partner takes its pane and the thread moves to the other
one instead. Maximize and restore
go through `sdk.threads.paneAction`, which BB delivers to every connected
window. The partner rules live in `lib/pairs.ts`.

BB plugins cannot close panes, so a lone thread is maximized instead.
The plugin reads BB's own `bb.splitLayout.maximizedPaneId` storage key to
find a maximized pane; that key is not a public API.

## Develop

```
npm install
npm test
npx tsc
bb plugin build
bb plugin install .
```
