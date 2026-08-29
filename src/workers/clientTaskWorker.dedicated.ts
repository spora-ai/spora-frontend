/// <reference lib="webworker" />
/**
 * clientTaskWorker.dedicated — Vite dedicated Worker entry (fallback).
 *
 * Used when the browser does not support SharedWorker (older Safari,
 * private modes). Each tab spins up its own instance, so the navbar
 * indicator surfaces a "single-tab mode" warning and the worker keeps
 * its `drivenTasks` map isolated to this tab.
 */
import { createClientWorkerCore, type InMsg } from './clientTaskWorkerCore'

declare const self: DedicatedWorkerGlobalScope

const core = createClientWorkerCore({
  fetch,
  port: { postMessage: (msg) => self.postMessage(msg) },
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
})

self.addEventListener('message', (event: Event) => {
  const msg = (event as MessageEvent).data as InMsg
  core.handle(msg)
})