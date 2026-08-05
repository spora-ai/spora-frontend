/**
 * useRealtime — unified real-time interface using SSE with automatic fallback to polling.
 *
 * Auto-connects on creation and cleans up on component unmount.
 * When Mercure is configured it uses SSE; otherwise it falls back to polling.
 *
 * Uses a module-level singleton EventSource so the SSE connection persists
 * across route changes (no reconnect churn on every navigation).
 */
import { ref, computed, onUnmounted } from 'vue'
import { useTaskStore } from '@/stores/tasks'
import { useNotificationStore } from '@/stores/notifications'
import { useAuthStore } from '@/stores/auth'
import { useAgentStore } from '@/stores/agent'
import { api } from '@/api/client'
import { log } from '@/utils/logger'

let globalEventSource: EventSource | null = null
let globalEventSourceUserId: number | null = null
let globalConnectPromise: Promise<void> | null = null
let globalCookieRefreshTimer: ReturnType<typeof setTimeout> | null = null
let globalUseRealtimeOpts: UseRealtimeOptions = {}
const globalConnected = ref(false)

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

/**
 * Subscribe to real-time updates (SSE) with automatic polling fallback.
 *
 * Auto-connects on creation. Returns a reactive `connected` flag.
 *
 * @param opts - {@link UseRealtimeOptions} controlling fallback behaviour.
 */
export function useRealtime(opts: UseRealtimeOptions = {}) {
  globalUseRealtimeOpts = opts
  const taskStore = useTaskStore()
  const notificationStore = useNotificationStore()
  const authStore = useAuthStore()
  const agentStore = useAgentStore()

  const currentUserId = authStore.user?.id ?? null

  // Reuse an open connection iff the user matches — a stale connection from
  // a previous login would deliver that user's topics to the wrong browser.
  if (currentUserId !== null
      && globalEventSource?.readyState === EventSource.OPEN
      && globalEventSourceUserId === currentUserId) {
    return { connected: globalConnected }
  }

  if (globalEventSource) {
    globalEventSource.close()
    globalEventSource = null
    globalEventSourceUserId = null
    clearCookieRefreshTimer()
  }

  if (globalConnectPromise) {
    return { connected: globalConnected }
  }

  globalConnectPromise = (async () => {
    try {
      // Wait for auth to be initialized before connecting
      if (!authStore.initialized) {
        // Auth not ready yet — poll until it is, then connect
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
          if (globalEventSource) {
            globalEventSource.close()
            globalEventSource = null
            globalEventSourceUserId = null
          }
          useRealtime()
        }, refreshInMs)
      }

      const baseUrl = authResponse.hubUrl
      const url = new URL(baseUrl, globalThis.location.origin)

      // append() adds both topics (set() overwrites the first one)
      url.searchParams.append('topic', `user/${userId}/tasks`)
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
        const topic = data.topic
        const innerData = data.data as Record<string, unknown>

        if (topic.startsWith('user/')) {
          // Topic format: user/{userId}/tasks or user/{userId}/notifications
          // The task id is inside the payload — either `task_id` (explicit publish)
          // or `id` (from taskResource()). Both are supported.
          type MercureTaskPayload = { task_id?: number; id?: number }
          const taskId = (innerData as MercureTaskPayload).task_id
            ?? (innerData as { id?: number }).id
          if (taskId === undefined) {
            // Notification event on user/{userId}/notifications
            type MercureNotificationPayload = { notification: Parameters<typeof notificationStore.prependFromSSE>[0] }
            const payload = innerData as MercureNotificationPayload
            if (payload.notification) {
              notificationStore.prependFromSSE(payload.notification)
            }
          } else {
            // Task event on user/{userId}/tasks — use targeted update
            taskStore.applyTaskUpdate(taskId, innerData)
            // Also update agentStore task list so AgentPage can skip polling
            agentStore.applySseTaskEvent(innerData)
            taskStore.applySseEventToTasks(innerData)
          }
        }
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
  })()

  globalConnectPromise.finally(() => {
    globalConnectPromise = null
  })

  onUnmounted(() => {
    // The singleton persists across route changes; do not close on unmount.
  })

  return { connected: computed(() => globalConnected) }

  function startPollingFallback(): void {
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
}
