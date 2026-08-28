import { watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useClientWorkerStore, type ClientWorkerStatus } from '@/stores/clientWorker'
import { useTaskStore } from '@/stores/tasks'
import { useToast } from '@/composables/useToast'
import { log } from '@/utils/logger'
import { api } from '@/api/client'

/**
 * useClientWorker — module-level singleton that boots the browser-
 * driven task worker.
 *
 * Called once from `GlobalNavbar.vue` alongside `useRealtime`. The
 * singleton persists across route changes and is torn down on logout
 * (or page reload — the SharedWorker itself is also tied to the
 * origin's lifetime and will be re-bootstrapped by the next call).
 *
 * Wire-up order:
 *   1. Wait for `runtimeConfig.init()` so we know whether client mode
 *      is enabled.
 *   2. Short-circuit to `idle` in server mode (no worker, hidden
 *      indicator).
 *   3. Prefer `SharedWorker` (multi-tab safe). Fall back to
 *      `Worker` (single-tab) with a warning toast.
 *   4. Post `{ type: 'init', ... }` with the CSRF token + endpoint
 *      templates so the worker can drive `/tick` and `/housekeeping`.
 *   5. Wire `port.onmessage` → store updates + toast notifications.
 *   6. Start a discovery poll (`/api/v1/tasks?status=QUEUED&since=…`)
 *      so the worker can find tasks even when Mercure/SSE is not
 *      configured (the typical dev / shared-host case).
 *
 * The composable also exposes {@link postConsiderTask} and
 * {@link postDropTask} for `useRealtime` to forward SSE events into the
 * worker's `drivenTasks` map. The discovery poll below is a redundant
 * fallback — if SSE works, this loop still runs but the worker
 * de-dupes via its drivenTasks map (the existing shape).
 */

interface WorkerPort {
  postMessage(msg: unknown): void
  onmessage: ((ev: MessageEvent) => void) | null
  start?(): void
  close?(): void
}

let globalPort: WorkerPort | null = null
let globalWorkerIsShared = false
let globalCleanupRegistered = false

// Discovery-poll state. When Mercure/SSE is unavailable, useRealtime
// falls back to polling the dashboard task list, but that polling does
// not forward into the worker. This separate poll on
// `/api/v1/tasks?status=QUEUED&since=…` keeps the worker's drivenTasks
// map populated regardless of SSE availability.
let globalPollTimer: ReturnType<typeof setInterval> | null = null
let globalPollLastSeenAt: string | null = null
let globalPollInflight = false

export async function useClientWorker(): Promise<void> {
  const config = useRuntimeConfigStore()
  const auth = useAuthStore()
  const store = useClientWorkerStore()
  const toast = useToast()

  if (!config.initialized) {
    await config.init()
  }

  if (!config.clientWorker.enabled) {
    store.setStatus('idle')
    return
  }

  if (globalPort !== null) return
  store.setStatus('booting')

  const initMsg = {
    type: 'init' as const,
    userId: auth.user?.id ?? 0,
    csrfToken: auth.csrfToken ?? '',
    tickEndpoint: config.clientWorker.tick_endpoint,
    housekeepingEndpoint: config.clientWorker.housekeeping_endpoint,
    tickIntervalMs: config.clientWorker.tick_interval_ms,
    housekeepingIntervalSeconds: config.clientWorker.housekeeping_interval_seconds,
    tickLeaseSeconds: config.clientWorker.tick_lease_seconds,
    baseUrl: typeof window !== 'undefined' ? window.location.origin : '',
  }

  try {
    if (typeof SharedWorker !== 'undefined') {
      const w = new SharedWorker(new URL('@/workers/clientTaskWorker.shared.ts', import.meta.url), { type: 'module' })
      globalPort = w.port
      globalWorkerIsShared = true
      w.port.start()
    } else {
      const w = new Worker(new URL('@/workers/clientTaskWorker.dedicated.ts', import.meta.url), { type: 'module' })
      const portLike: WorkerPort = {
        postMessage: (msg) => w.postMessage(msg),
        onmessage: null,
        close: () => w.terminate(),
      }
      globalPort = portLike
      globalWorkerIsShared = false
      w.onmessage = (ev: MessageEvent) => {
        if (portLike.onmessage !== null) {
          portLike.onmessage(ev)
        }
      }
      store.setStatus('degraded', 'Single-tab mode (SharedWorker unavailable)')
      toast.warning('This browser does not support SharedWorker — using a per-tab fallback.')
    }

    globalPort.onmessage = (ev: MessageEvent) => {
      const data = ev.data as {
        type: string
        status?: ClientWorkerStatus
        reason?: string | null
        drivenTaskCount?: number
        taskId?: number
        ok?: boolean
        task?: Record<string, unknown>
      }
      if (data.type === 'status') {
        const next = data.status ?? 'active'
        store.setStatus(next, data.reason ?? null)
        if (typeof data.drivenTaskCount === 'number') {
          store.setDrivenTaskCount(data.drivenTaskCount)
        }
        return
      }
      if (data.type === 'tick-result' && data.ok === true && data.task !== undefined) {
        // The worker has just ticked a task and the server returned a
        // fresh taskResource. Apply it to the SPA now so the chat shows
        // the new tool calls + history entries without waiting for the
        // next 2 s `startDetailPolling` cycle. The task store handles all
        // three sinks (active chat, dashboard list, sub-task cache) via
        // its existing `applyTaskUpdate` + `applySseEventToTasks` pair —
        // the same path Mercure-driven updates flow through.
        const taskStore = useTaskStore()
        const taskId = data.taskId
        if (typeof taskId === 'number') {
          taskStore.applyTaskUpdate(taskId, data.task)
        }
        taskStore.applySseEventToTasks(data.task)
      }
    }

    globalPort.postMessage(initMsg)

    if (globalWorkerIsShared) {
      store.setStatus('active')
      toast.info('Client-side worker is now ticking your tasks. Keep this browser tab open while tasks are running.')
    }

    if (!globalCleanupRegistered) {
      globalCleanupRegistered = true
      // Tear down on logout. Watching `auth.user` rather than a derived
      // boolean because the auth store does not expose a `isAuthenticated`
      // getter — the user ref is the source of truth.
      watch(
        () => auth.user,
        (next) => {
          if (next === null && globalPort !== null) {
            try {
              globalPort.postMessage({ type: 'shutdown' })
            } catch (e) {
              log.debug('[useClientWorker] shutdown postMessage failed', e)
            }
            globalPort.close?.()
            globalPort = null
            globalWorkerIsShared = false
            stopDiscoveryPoll()
            store.setStatus('idle')
          }
        },
      )
    }

    startDiscoveryPoll(initMsg.userId)
  } catch (e) {
    store.setStatus('error', e instanceof Error ? e.message : 'Worker init failed')
    log.error('[useClientWorker] init failed', e)
  }
}

/** Forward a QUEUED/RUNNING task into the worker's `drivenTasks` map. */
export function postConsiderTask(taskId: number, leaseOwner: string): void {
  globalPort?.postMessage({ type: 'consider-task', taskId, leaseOwner })
}

/** Remove a task from the worker's `drivenTasks` map (terminal / quiescent). */
export function postDropTask(taskId: number): void {
  globalPort?.postMessage({ type: 'drop-task', taskId })
}

/**
 * Poll `/api/v1/tasks?status=QUEUED&since=lastSeenAt` every 5 s and push
 * each newly seen task into the worker. Runs alongside (not instead of)
 * the SSE forwarder in `useRealtime` — when Mercure is configured, SSE
 * drives the worker instantly and this poll is a redundant fallback;
 * when Mercure is NOT configured (the typical shared-host case), this
 * poll is the only discovery primitive the worker has.
 *
 * Module-level singleton — idempotent. Safe to call repeatedly; only
 * the first call after a worker boot actually starts the timer.
 */
function startDiscoveryPoll(userId: number): void {
  if (globalPollTimer !== null) return
  if (typeof window === 'undefined') return
  globalPollLastSeenAt = null

  const intervalMs = 5000
  const tick = async (): Promise<void> => {
    if (globalPollInflight) return
    if (globalPort === null) return // worker torn down
    globalPollInflight = true
    try {
      const query: Record<string, string> = { status: 'QUEUED' }
      if (globalPollLastSeenAt !== null) {
        query.since = globalPollLastSeenAt
      }
      const res = await api.get<{
        tasks: Array<{ id: number; updated_at: string }>
      }>('/tasks', query)
      const tasks = res.tasks ?? []
      let newest = globalPollLastSeenAt
      for (const t of tasks) {
        postConsiderTask(t.id, `user:${userId}`)
        if (newest === null || t.updated_at > newest) {
          newest = t.updated_at
        }
      }
      globalPollLastSeenAt = newest
    } catch (e) {
      // Network blip or transient 5xx — silent retry next interval.
      log.debug('[useClientWorker] discovery poll failed', e)
    } finally {
      globalPollInflight = false
    }
  }

  // Run once immediately so the user does not wait 5 s for the first
  // task to be picked up after page load.
  void tick()
  globalPollTimer = setInterval(() => { void tick() }, intervalMs)
}

function stopDiscoveryPoll(): void {
  if (globalPollTimer !== null) {
    clearInterval(globalPollTimer)
    globalPollTimer = null
  }
  globalPollLastSeenAt = null
  globalPollInflight = false
}

/**
 * Test seam — clears the module-level poll state without touching the
 * worker. Used by the test suite to reset between cases.
 */
export function __resetDiscoveryPollForTests(): void {
  stopDiscoveryPoll()
}

/**
 * Tear down the current worker (if any) and re-init from scratch.
 *
 * Wired to the "Restart worker" button on the ClientWorkerIndicator
 * popover — used when the user has been sitting in the error state for
 * a while and the auto-recovery hasn't kicked in. Safe to call when no
 * worker is running.
 */
export async function restartClientWorker(): Promise<void> {
  if (globalPort !== null) {
    try {
      globalPort.postMessage({ type: 'shutdown' })
    } catch (e) {
      log.debug('[useClientWorker] restart shutdown postMessage failed', e)
    }
    globalPort.close?.()
    globalPort = null
    globalWorkerIsShared = false
  }
  await useClientWorker()
}