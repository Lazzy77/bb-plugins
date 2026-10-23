# Thread Pairs

A BB plugin that opens a thread together with its subthread, without reloading
the window.

- Open a thread that has subthreads: its subthread appears in the other pane.
  With several subthreads, the one you last focused next to it wins, otherwise
  the most recently updated one.
- Open a subthread: its parent appears in the other pane.
- Open a thread with neither: the other panes close and it fills the window.
- The parent always ends up on the left and the subthread on the right,
  whichever pane had focus; focus stays on the thread you opened.
- New thread works like a thread without subthreads: the other panes close.
  Once the focused thread gets its first subthread, the pair opens side by
  side.
- A pair never shares the window with a third pane: extra panes close.

A thread that newly appears on screen triggers the plugin. Focusing a thread
that is already open triggers it only when neither its parent nor any of its
children is on screen, so moving focus within a pair changes nothing. Only a
newly opened lone thread closes the other panes.

Every decision is traced to the plugin log (`bb plugin logs thread-pairs`).

## How it works

`app.tsx` mounts an invisible overlay that watches the split layout
(`useSidebarSplitLayout`) and the routed thread. When a thread lands in the
focused pane, it focuses the other pane, replaces its thread with the partner
and focuses back, all through `useBbNavigate().toThread`. When the thread landed
on the wrong side, the partner takes its pane and the thread moves to the other
one instead. Extra panes are closed first. Restoring a maximized pane goes
through `sdk.threads.paneAction`, which BB delivers to every connected window.
The partner and pane rules live in `lib/pairs.ts`.

BB plugins have no API to close a pane, so the plugin presses the pane's own
close button (`[data-split-pane-id] button[aria-label="Close pane"]`). If a
future BB changes that markup, a lone thread is maximized instead, and the
log shows `close-failed`. A pane maximized earlier is restored through BB's
`bb.splitLayout.maximizedPaneId` storage key; neither is a public API.

## Develop

```
npm install
npm test
npx tsc
bb plugin build
bb plugin install .
```
