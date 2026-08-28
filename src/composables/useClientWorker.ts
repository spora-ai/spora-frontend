import { watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useClientWorkerStore, type ClientWorkerStatus } from '@/stores/clientWorker'
import { useToast } from '@/composables/useToast'
import { log } from '@/utils/logger'

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
 *
 * The composable also exposes {@link postConsiderTask} and
 * {@link postDropTask} for `useRealtime` to forward SSE events into the
 * worker's `drivenTasks` map.
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
      }
      if (data.type === 'status') {
        const next = data.status ?? 'active'
        store.setStatus(next, data.reason ?? null)
        if (typeof data.drivenTaskCount === 'number') {
          store.setDrivenTaskCount(data.drivenTaskCount)
        }
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
            store.setStatus('idle')
          }
        },
      )
    }
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