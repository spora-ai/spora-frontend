/// <reference lib="webworker" />
/**
 * clientTaskWorker.shared — Vite SharedWorker entry.
 *
 * SharedWorkers live once per origin and broadcast to every connected
 * client — perfect for ticking tasks across multiple tabs without
 * duplicating work. Vite picks up `?sharedworker` from the `new URL(...,
 * import.meta.url)` import pattern in the calling site and bundles this
 * file as the worker's entry point.
 */
import { createClientWorkerCore, type InMsg } from './clientTaskWorkerCore'

declare const self: SharedWorkerGlobalScope

self.addEventListener('connect', (event: Event) => {
  const connectEvent = event as MessageEvent
  const clientPort = connectEvent.ports[0]
  if (clientPort === undefined) return

  const core = createClientWorkerCore({
    fetch,
    port: { postMessage: (msg) => clientPort.postMessage(msg) },
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
  })

  clientPort.addEventListener('message', (ev: Event) => {
    const msg = (ev as MessageEvent).data as InMsg
    core.handle(msg)
  })
  clientPort.start()
})