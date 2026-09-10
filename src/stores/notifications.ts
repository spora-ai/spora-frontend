import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import { api } from '@/api/client'

/**
 * Manages notifications: fetch, mark read, delete, and real-time updates via SSE.
 */
export interface Notification {
  id: number
  type: 'task_completed' | 'task_failed' | 'pending_approval' | 'scheduled_run_completed'
  title: string
  body: string | null
  data: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

export const useNotificationStore = defineStore('notifications', () => {
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  // `shallowRef` skips deep Proxy wrapping for each Notification object.
  // Mutations replace the array reference so Vue picks up the change —
  // see the helpers below for the immutable update pattern. For users
  // with thousands of historical notifications this saves a Proxy per
  // item; for the common case it's the same speed with less overhead.
  const notifications = shallowRef<Notification[]>([])
  const unreadCount = computed(() => {
    const list = notifications.value
    let count = 0
    for (const n of list) {
      if (n.read_at === null) count++
    }
    return count
  })

  async function fetchNotifications(): Promise<void> {
    const result = await api.get<{ notifications: Notification[] }>('/notifications')
    // Guard against a malformed response: the `unreadCount` computed reads
    // `.filter` on this value on every reactive tick and would crash the
    // navbar if it ever became undefined.
    notifications.value = result.notifications ?? []
  }

  async function markRead(id: number): Promise<void> {
    await api.post(`/notifications/${id}/read`)
    const list = notifications.value
    const idx = list.findIndex(n => n.id === id)
    if (idx === -1) return
    const target = list[idx]
    if (target.read_at !== null) return
    const next = list.slice()
    next[idx] = { ...target, read_at: new Date().toISOString() }
    notifications.value = next
  }

  async function markAllRead(): Promise<void> {
    await api.post('/notifications/read-all')
    const now = new Date().toISOString()
    const next = notifications.value.map(n =>
      n.read_at === null ? { ...n, read_at: now } : n,
    )
    notifications.value = next
  }

  async function deleteNotification(id: number): Promise<void> {
    await api.delete(`/notifications/${id}`)
    notifications.value = notifications.value.filter(n => n.id !== id)
  }

  async function deleteAll(): Promise<void> {
    await api.delete('/notifications')
    notifications.value = []
  }

  /**
   * Called by useRealtime when a SSE notification event arrives.
   * Checks if the notification is already in the list (by id); if not,
   * inserts it in sorted position rather than unshifting + resorting —
   * an O(N log N) sort on every SSE event is wasteful when a linear
   * insert-by-`created_at` does the same in O(N).
   */
  function prependFromSSE(notification: Notification): void {
    const list = notifications.value
    if (list.some(n => n.id === notification.id)) return
    const ts = new Date(notification.created_at).getTime()
    let insertAt = list.length
    for (let i = 0; i < list.length; i++) {
      if (new Date(list[i].created_at).getTime() <= ts) {
        insertAt = i
        break
      }
    }
    const next = list.slice()
    next.splice(insertAt, 0, notification)
    notifications.value = next
  }

  function startNotificationPolling(): void {
    stopNotificationPolling()
    const tick = async () => {
      try {
        await fetchNotifications()
      } catch {
        // Network or API error — keep polling, don't crash
      } finally {
        pollTimer = setTimeout(tick, 60_000) // every 60s
      }
    }
    pollTimer = setTimeout(tick, 60_000)
  }

  function stopNotificationPolling(): void {
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  return {
    notifications,
    unreadCount,
    fetchNotifications,
    markRead,
    markAllRead,
    deleteNotification,
    deleteAll,
    prependFromSSE,
    startNotificationPolling,
    stopNotificationPolling,
  }
})