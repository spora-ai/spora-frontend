import { api } from './client'

/**
 * One row of `notification_subscriptions`. Identifies the user, the
 * target (either an `agent` or a `principal` like a user- or group-
 * principal), and the wall-clock time the row was created.
 *
 * `target_id` resolution: when `target_type = 'agent'` the id is an
 * `agents.id`; when `target_type = 'principal'` the id is a
 * `principals.id` (mirrors `Agent.principal_id`).
 */
export interface NotificationSubscription {
  id: number
  user_id: number
  target_type: 'agent' | 'principal'
  target_id: number
  created_at: string
}

export interface SubscriptionTarget {
  target_type: 'agent' | 'principal'
  target_id: number
}

export interface SubscriptionsResponse {
  /**
   * Server-wide kill switch for the scheduled-run email dispatch.
   * `false` triggers the "email is currently disabled on this server"
   * banner in the SPA. Defaults to `true` server-side; the SPA treats
   * the field as the source of truth.
   */
  email_enabled: boolean
  /**
   * The caller's user-principal id. `null` when the user has no
   * user-principal row yet (rare; sign-in usually creates one).
   */
  user_principal_id: number | null
  /** Every subscription the authenticated user holds. */
  subscriptions: NotificationSubscription[]
}

export const notificationSubscriptionsApi = {
  /** Every subscription the authenticated user holds, plus the caller's user_principal_id. */
  list: (): Promise<SubscriptionsResponse> =>
    api.get<SubscriptionsResponse>('/notifications/subscriptions'),

  /**
   * Subscribe the current user to a target. Idempotent — repeat calls
   * do not duplicate the row.
   */
  subscribe: (target: SubscriptionTarget): Promise<{ subscribed: boolean }> =>
    api.post<{ subscribed: boolean }>('/notifications/subscriptions', target)
      .then((r) => ({ subscribed: Boolean(r.subscribed) })),

  /**
   * Unsubscribe the current user from a target. Idempotent — repeat
   * calls succeed even when the row is already gone.
   */
  unsubscribe: (target: SubscriptionTarget): Promise<{ unsubscribed: boolean }> =>
    api.delete<{ unsubscribed: boolean }>(
      `/notifications/subscriptions?target_type=${encodeURIComponent(target.target_type)}&target_id=${encodeURIComponent(String(target.target_id))}`,
    ).then((r) => ({ unsubscribed: Boolean(r.unsubscribed) })),
}
