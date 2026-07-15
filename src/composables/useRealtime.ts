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
const globalConnected = ref(false)

export { globalConnected }

export interface UseRealtimeOptions {
  /** When true, do not auto-start the dashboard task polling fallback
   * if SSE is unavailable. Notification polling is unaffected (the
   * navbar bell still needs it). Default false. */
  skipDashboardPolling?: boolean
}

/**
 * Subscribe to real-time updates (SSE) with automatic polling fallback.
 *
 * Auto-connects on creation. Returns a reactive `connected` flag.
 *
 * @param opts - {@link UseRealtimeOptions} controlling fallback behaviour.
 */
export function useRealtime(opts: UseRealtimeOptions = {}) {
  const taskStore = useTaskStore()
  const notificationStore = useNotificationStore()
  const authStore = useAuthStore()
  const agentStore = useAgentStore()

  // Reuse existing SSE connection if already open. CONNECTING is
  // deliberately NOT short-circuited — module-level singletons persist
  // across test calls, and short-circuiting on CONNECTING would mask test
  // ordering issues. In real use a CONNECTING state lasts a single HTTP
  // roundtrip; if a duplicate `useRealtime()` call lands in that window,
  // the worst case is two parallel handshakes that both close themselves
  // when the singleton handshake completes.
  if (globalEventSource?.readyState === EventSource.OPEN) {
    return { connected: globalConnected }
  }

  // Clean up any stale connection before creating a new one
  if (globalEventSource) {
    globalEventSource.close()
    globalEventSource = null
  }

  async function connect(): Promise<void> {
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

      // Not logged in — skip SSE entirely
      if (authStore.user === null) {
        startPollingFallback()
        return
      }

      // First check if SSE is configured and active
      const statusResponse = await api.get<{ active: boolean; hubUrl?: string }>('/sse/status')
      if (!statusResponse.active || !statusResponse.hubUrl) {
        startPollingFallback()
        return
      }

      // Fetch auth token and subscribe to user-specific notification topic
      const authResponse = await api.get<{ hubUrl: string; token: string }>('/sse/auth')
      const userId = authStore.user.id

      // Support both relative (/path) and absolute (http://host/path) hubUrl
      const baseUrl = authResponse.hubUrl
      const url = new URL(baseUrl, globalThis.location.origin)

      // append() adds both topics (set() overwrites the first one)
      url.searchParams.append('topic', `user/${userId}/tasks`)
      url.searchParams.append('topic', `user/${userId}/notifications`)

      globalEventSource = new EventSource(url.toString())

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

      globalEventSource.onerror = () => {
        // Network error or hub unreachable — tear down and fall back to polling
        disconnect()
        startPollingFallback()
      }

      globalConnected.value = true
      taskStore.stopDashboardPolling()
      notificationStore.stopNotificationPolling()
      notificationStore.fetchNotifications()
    } catch {
      // Auth endpoint returned 404 or network error — Mercure not available; use polling
      startPollingFallback()
    }
  }

  function startPollingFallback(): void {
    globalConnected.value = false

    // Stop any lingering SSE connection
    if (globalEventSource) {
      globalEventSource.close()
      globalEventSource = null
    }

    // Start the adaptive polling loop managed entirely by the store.
    // Dashboard polling is opt-out via `opts.skipDashboardPolling` so callers
    // (e.g. the new dashboard page) can keep SSE updates live while relying
    // on manual refresh instead of an auto-polling tick. Notification
    // polling is intentionally NOT gated — the navbar bell needs it.
    if (!opts.skipDashboardPolling) {
      taskStore.startDashboardPolling()
    }
    notificationStore.startNotificationPolling()
    // Bootstrap the badge immediately — the polling tick would otherwise
    // wait 60s for the first fetch. Fire-and-forget with a logged catch
    // so a transient failure never escapes as an unhandled rejection.
    notificationStore.fetchNotifications().catch((e) => {
      log.warn('[useRealtime] bootstrap fetchNotifications failed; polling will retry in 60s', e)
    })
  }

  function disconnect(): void {
    if (globalEventSource) {
      globalEventSource.close()
      globalEventSource = null
    }
    globalConnected.value = false
  }

  connect()

  onUnmounted(() => {
    // Only disconnect if no other consumer is using the connection.
    // Since we share the singleton, we don't auto-disconnect on unmount —
    // the connection persists across route changes.
  })

  return { connected: computed(() => globalConnected) }
}