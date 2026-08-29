/// <reference lib="webworker" />
/**
 * clientTaskWorker.shared — Vite SharedWorker entry.
 *
 * SharedWorkers live once per origin and broadcast to every connected
 * client. Vite picks up `?sharedworker` from the `new URL(...,
 * import.meta.url)` import pattern in the calling site and bundles this
 * file as the worker's entry point.
 *
 * One core, many ports — every `connect` event re-uses the same
 * `createClientWorkerCore` instance. Without this, N tabs would run N
 * independent tick + housekeeping loops, each issuing `/tick` for the
 * same QUEUED tasks and racing each other through the server's CAS-
 * claim. The server's lease is the source of truth, so only one tick
 * per task would actually succeed — the rest would log TICK_LOST_RACE
 * warnings and waste CPU. The single-core design also matches the PR
 * body's claim of "perfect for ticking across multiple tabs without
 * duplicating work".
 *
 * Outgoing messages are broadcast to every connected port. Each tab's
 * `useClientWorker` handler is idempotent for tasks it doesn't care
 * about (driving flags flip on/off for tasks that aren't displayed),
 * so over-delivery is safe.
 */
import { createClientWorkerCore, type InMsg } from './clientTaskWorkerCore'

declare const self: SharedWorkerGlobalScope

const ports = new Set<MessagePort>()

// Hoist the core to module scope. Re-create it across a worker restart
// (`self.restart()` is rare but supported by some browsers); the boot
// flag inside the core prevents double-init from the same client.
const core = createClientWorkerCore({
  fetch,
  port: {
    // Fan out to every connected port. Ports that have disconnected are
    // pruned in the `messageerror` / `close` listener below, so a
    // delivered-but-never-read message would silently drop — fine,
    // because `useClientWorker` is the only consumer and reconnect
    // logic re-issues `consider-task` for any driven task.
    postMessage: (msg) => {
      for (const p of ports) {
        p.postMessage(msg)
      }
    },
  },
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
})

self.addEventListener('connect', (event: Event) => {
  const connectEvent = event as MessageEvent
  const clientPort = connectEvent.ports[0]
  if (clientPort === undefined) return

  ports.add(clientPort)

  // Prune on disconnect so the broadcast loop doesn't waste a `postMessage`
  // on a port the browser has already GC'd. `close` fires when the page
  // navigates away; `messageerror` fires on a malformed frame.
  clientPort.addEventListener('close', () => { ports.delete(clientPort) })
  clientPort.addEventListener('messageerror', () => { ports.delete(clientPort) })

  clientPort.addEventListener('message', (ev: Event) => {
    const msg = (ev as MessageEvent).data as InMsg
    core.handle(msg)
  })
  clientPort.start()
})