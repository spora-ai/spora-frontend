/**
 * Real-time updates over SSE, with a polling fallback when Mercure is not
 * configured.
 *
 * The EventSource is a module-level singleton so the connection persists
 * across route changes instead of reconnecting on every navigation.
 *
 * Topics: subscribers receive `principal/{id}/tasks` for every principal they
 * can act as (user-principal + group-principals of their groups) plus the
 * user-keyed `user/{id}/notifications` topic for the bell badge.
 */
import { ref, computed, onUnmounted, watch } from 'vue'
import { useTaskStore } from '@/stores/tasks'
import { useNotificationStore } from '@/stores/notifications'
import { useAuthStore } from '@/stores/auth'
import { useAgentStore } from '@/stores/agent'
import { usePrincipalsStore } from '@/stores/principals'
import { api } from '@/api/client'
import { log } from '@/utils/logger'
import { postConsiderTask, postDropTask } from './useClientWorker'

let globalEventSource: EventSource | null = null
let globalEventSourceUserId: number | null = null
let globalConnectPromise: Promise<void> | null = null
// Tracks whose connection is in flight. `tearDownConnection()` nulls
// `globalEventSourceUserId`, so an in-flight `connectSse()` can no longer be
// attributed to a user by reading it — the matching `currentUserId` from the
// second `useRealtime()` would compare against `null` and bypass the
// short-circuit. Pinning the userId on the promise closes the race where two
// `useRealtime()` calls for different users overlap.
let globalConnectPromiseUserId: number | null = null
let globalCookieRefreshTimer: ReturnType<typeof setTimeout> | null = null
let globalUseRealtimeOpts: UseRealtimeOptions = {}
// `principalWatchInstalled` gates the module-scope Vue watcher. A `watch`
// registered *inside* useRealtime re-entered useRealtime from the watcher
// callback, which leaked one unbound watcher per component mount (Vue's
// `getCurrentInstance()` returns null inside a watcher callback, so the new
// watch was bound to no component's lifecycle). Installing once at module
// scope and routing the reconnect through connectSse() breaks the cycle.
let principalWatchInstalled = false
const globalConnected = ref(false)

// Statuses that mean the client worker should drive the task vs. those that
// mean it should forget about it. Matched by string equality (not the
// frontend's TaskStatus union) because the backend publishes `QUEUED`, which
// isn't in the union. Keeping these as Sets turns the routing into a single
// membership test.
const DRIVEN_STATUSES: ReadonlySet<string> = new Set(['QUEUED', 'RUNNING', 'PENDING'])
const QUIESCENT_STATUSES: ReadonlySet<string> = new Set([
  'COMPLETED', 'FAILED', 'CANCELLED', 'ABORTED', 'PENDING_APPROVAL', 'AWAITING_SUB_AGENTS',
])

function applyTaskEventAndForward(
  taskId: number,
  innerData: Record<string, unknown>,
  userId: number,
): void {
  // Targeted task-store updates so AgentPage can skip polling.
  const taskStore = useTaskStore()
  const agentStore = useAgentStore()
  taskStore.applyTaskUpdate(taskId, innerData)
  agentStore.applySseTaskEvent(innerData)
  taskStore.applySseEventToTasks(innerData)
  // Forward into the client worker so it knows to drive the task or stop
  // ticking it. The worker key is the trigger user (not the principal owner)
  // — the trigger user is the one whose credentials and session the client
  // worker is driving on behalf of.
  const status = typeof innerData.status === 'string' ? innerData.status : null
  if (status === null) return
  if (DRIVEN_STATUSES.has(status)) {
    postConsiderTask(taskId, `user:${userId}`)
  } else if (QUIESCENT_STATUSES.has(status)) {
    postDropTask(taskId)
  }
}

export { globalConnected }

export interface UseRealtimeOptions {
  /** When true, do not auto-start the dashboard task polling fallback
   * if SSE is unavailable. Notification polling is unaffected (the
   * navbar bell still needs it). Default false. */
  skipDashboardPolling?: boolean
}

function clearCookieRefreshTimer(): void {
  if (globalCookieRefreshTimer) {
    clearTimeout(globalCookieRefreshTimer)
    globalCookieRefreshTimer = null
  }
}

function tearDownConnection(): void {
  if (globalEventSource) {
    globalEventSource.close()
    globalEventSource = null
    globalEventSourceUserId = null
  }
  clearCookieRefreshTimer()
  globalConnectPromise = null
  globalConnectPromiseUserId = null
}

/**
 * Connect (or re-mint) the SSE connection. Module-scope so the principal
 * watcher can call it without re-entering `useRealtime()` and leaking another
 * watch handle.
 *
 * The promise returned via {@link reconnectSse} is tagged with the triggering
 * userId, so a second call for a different user tears the first connection
 * down and starts a fresh one. Callers MUST go through `reconnectSse()`
 * rather than calling `connectSse()` directly, so the promise + userId
 * bookkeeping stays consistent.
 */
async function connectSse(): Promise<void> {
  const taskStore = useTaskStore()
  const notificationStore = useNotificationStore()
  const authStore = useAuthStore()
  const principalsStore = usePrincipalsStore()

  try {
    if (!authStore.initialized) {
      await new Promise<void>(resolve => {
        let attempts = 0
        const stop = setInterval(() => {
          attempts++
          if (authStore.initialized || attempts > 100) { // 5s timeout
            clearInterval(stop)
            resolve()
          }
        }, 50)
      })
    }

    // Capture userId up front so a logout/login during the cookie fetch
    // doesn't pair this user's cookie with the next user's topics.
    const userId = authStore.user?.id
    if (userId == null) {
      startPollingFallback()
      return
    }

    const statusResponse = await api.get<{ active: boolean; hubUrl?: string }>('/sse/status')
    if (!statusResponse.active || !statusResponse.hubUrl) {
      startPollingFallback()
      return
    }

    // EventSource cannot send a Bearer header — /sse/authorize sets its cookie.
    // Keep /sse/auth for non-browser clients.
    const authResponse = await api.get<{ hubUrl: string; expires: number }>('/sse/authorize')

    // Re-check identity after the await; abandon if the user changed mid-flight.
    if (authStore.user?.id !== userId) {
      return
    }

    // Re-mint the cookie ~1 minute before the JWT expires.
    const refreshInMs = authResponse.expires * 1000 - Date.now() - 60_000
    if (refreshInMs > 0) {
      clearCookieRefreshTimer()
      globalCookieRefreshTimer = setTimeout(() => {
        globalCookieRefreshTimer = null
        tearDownConnection()
        void connectSse()
      }, refreshInMs)
    }

    const baseUrl = authResponse.hubUrl
    const url = new URL(baseUrl, globalThis.location.origin)
    // Pin the SSE hub to same-origin. The server-controlled `hubUrl`
    // response field is the trust boundary: a compromised or
    // misconfigured server could otherwise redirect the browser's
    // EventSource — which silently sends the user's session cookie
    // when `withCredentials: true` is set — to an attacker host. The
    // hub is always served from the SPA's own origin today, so a
    // mismatch is treated as a misconfiguration and we fall back to
    // polling rather than connect to an unexpected peer.
    if (url.origin !== globalThis.location.origin) {
      log.warn(
        '[useRealtime] refusing cross-origin SSE hubUrl; falling back to polling',
        { hubOrigin: url.origin, pageOrigin: globalThis.location.origin },
      )
      startPollingFallback()
      return
    }

    // Subscribe to every principal-keyed task topic the user can act as
    // (user-principal + group-principals of their groups). Notification
    // events stay user-keyed — the notifications table is per-user, so a
    // group-wide topic would notify the wrong recipients.
    for (const principalId of principalsStore.visiblePrincipalIds) {
      url.searchParams.append('topic', `principal/${principalId}/tasks`)
    }
    url.searchParams.append('topic', `user/${userId}/notifications`)

    // Same-origin cookies are sent automatically; withCredentials is the
    // forward-compat signal for a future cross-origin hub.
    globalEventSource = new EventSource(url.toString(), { withCredentials: true })
    globalEventSourceUserId = userId

    // Set connection state on open, not on construct — eager setting would
    // report "connected" while the handshake is still in flight.
    globalEventSource.onopen = () => {
      globalConnected.value = true
      taskStore.stopDashboardPolling()
      notificationStore.stopNotificationPolling()
      notificationStore.fetchNotifications().catch((e) => {
        log.warn('[useRealtime] onopen fetchNotifications failed', e)
      })
    }

    globalEventSource.onmessage = (event: MessageEvent) => {
      // The server is the trust boundary, but a malformed payload must
      // not crash the SSE handler — drop anything that doesn't match the
      // expected { topic, data } envelope.
      let data: { topic?: unknown; data?: unknown }
      try {
        data = JSON.parse(event.data) as { topic?: unknown; data?: unknown }
      } catch {
        return
      }
      if (typeof data.topic !== 'string' || typeof data.data !== 'object' || data.data === null) {
        return
      }
      // Task events are principal-keyed; the `user/` prefix only ever
      // carries the notifications topic, which returned above. The backend
      // publishes task state to `principal/{id}/tasks` only, so a
      // `user/{id}/…` topic that is not the notifications topic is not a task
      // event and must not be applied to the task store.
      const isTaskTopic = data.topic.startsWith('principal/')
      const isNotificationTopic = data.topic.startsWith('user/') && data.topic.endsWith('/notifications')
      if (isNotificationTopic) {
        type MercureNotificationPayload = { notification: Parameters<typeof notificationStore.prependFromSSE>[0] }
        const payload = data.data as MercureNotificationPayload
        if (payload.notification) {
          notificationStore.prependFromSSE(payload.notification)
        }
        return
      }
      if (!isTaskTopic) return
      // The task id is inside the payload — either `task_id` (explicit
      // publish) or `id` (from taskResource()). Both are supported.
      type MercureTaskPayload = { task_id?: number; id?: number }
      const innerData = data.data as Record<string, unknown>
      const taskId = (innerData as MercureTaskPayload).task_id
        ?? (innerData as { id?: number }).id
      if (taskId === undefined) return
      applyTaskEventAndForward(taskId, innerData, userId)
    }

    // Cookie handshake failures surface here, outside the fetch try/catch
    // above. Don't close the source — the browser's native EventSource
    // retry handles transient errors, and the cookie-refresh timer above
    // handles the expired-JWT case.
    globalEventSource.onerror = () => {
      globalConnected.value = false
      startPollingFallback()
    }
  } catch {
    // Polling preserves updates when SSE setup fails.
    startPollingFallback()
  }
}

/**
 * `true` when the two id lists represent the same set, regardless of order.
 */
function isSamePrincipalSet(
  newIds: readonly number[] | null,
  oldIds: readonly number[] | null,
): boolean {
  if (newIds === oldIds) return true
  if (newIds === null || oldIds === null) return false
  if (newIds.length !== oldIds.length) return false
  const newSet = new Set(newIds)
  for (const id of oldIds) {
    if (!newSet.has(id)) return false
  }
  return true
}

function startPollingFallback(): void {
  const taskStore = useTaskStore()
  const notificationStore = useNotificationStore()

  globalConnected.value = false
  clearCookieRefreshTimer()

  if (!globalUseRealtimeOpts.skipDashboardPolling) {
    taskStore.startDashboardPolling()
  }
  notificationStore.startNotificationPolling()
  notificationStore.fetchNotifications().catch((e) => {
    log.warn('[useRealtime] bootstrap fetchNotifications failed; polling will retry in 60s', e)
  })
}

/**
 * Mint (or remint) the SSE connection under a single shared promise so the
 * module-scope principal watcher and the per-component `useRealtime()` callers
 * cannot race to assign `globalEventSource`. The promise is tagged with the
 * userId it was started for, so a second `useRealtime()` for a different user
 * does not inherit the first user's in-flight connection.
 */
function reconnectSse(userId: number | null): void {
  if (globalConnectPromise && globalConnectPromiseUserId === userId) return
  tearDownConnection()
  globalConnectPromiseUserId = userId
  globalConnectPromise = connectSse().finally(() => {
    globalConnectPromise = null
    globalConnectPromiseUserId = null
  })
}

/**
 * Subscribe to real-time updates (SSE) with automatic polling fallback.
 * Auto-connects on creation; returns a reactive `connected` flag.
 */
export function useRealtime(opts: UseRealtimeOptions = {}) {
  globalUseRealtimeOpts = opts
  const authStore = useAuthStore()
  const currentUserId = authStore.user?.id ?? null

  // Re-mint the SSE connection when the user's visible principals change
  // (group join/leave). The principal-keyed topics are baked into the JWT at
  // mint time; without this watcher the user would miss new principal topics
  // for up to the JWT TTL (~1h). Installed exactly once per module load.
  if (!principalWatchInstalled) {
    principalWatchInstalled = true
    const principalsStore = usePrincipalsStore()
    watch(
      () => principalsStore.visiblePrincipalIds,
      (newIds, oldIds) => {
        if (isSamePrincipalSet(newIds, oldIds ?? null)) return
        // Re-read the current user at fire time — the closure-captured
        // `currentUserId` was the user when `useRealtime()` first ran
        // and may be stale if a logout/login happened since.
        const userIdAtFire = useAuthStore().user?.id ?? null
        reconnectSse(userIdAtFire)
      },
    )
  }

  // Reuse an open connection iff the user matches — a stale connection from
  // a previous login would deliver that user's topics to the wrong browser.
  if (currentUserId !== null
      && globalEventSource?.readyState === EventSource.OPEN
      && globalEventSourceUserId === currentUserId) {
    return { connected: globalConnected }
  }

  // In-flight reconnect for the same user → wait it out. A different user's
  // in-flight connection must NOT be inherited (its topics would target the
  // wrong browser); fall through to `reconnectSse()` which tears the existing
  // one down and starts a fresh one for the current user.
  if (globalConnectPromise && globalConnectPromiseUserId === currentUserId) {
    return { connected: globalConnected }
  }

  reconnectSse(currentUserId)

  onUnmounted(() => {
    // The singleton persists across route changes; do not close on unmount.
  })

  return { connected: computed(() => globalConnected) }
}
