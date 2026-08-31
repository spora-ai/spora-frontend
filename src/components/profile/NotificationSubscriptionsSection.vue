<script setup lang="ts">
/**
 * Email notifications for scheduled runs.
 *
 * Two row groups at most: "My personal agents" (a single toggle
 * targeting the caller's user-principal) and one row per group the
 * caller is a member of. Per-agent toggles were dropped — one row
 * per agent scales linearly with the fleet, and a group-principal
 * subscription already covers the per-group case.
 */
import { computed, onMounted, ref } from 'vue'
import { ApiError } from '@/api/client'
import {
  notificationSubscriptionsApi,
  type NotificationSubscription,
} from '@/api/notificationSubscriptions'
import { groupsApi } from '@/api/groups'

interface AvailableTarget {
  target_type: 'agent' | 'principal'
  target_id: number
  label: string
  hint: string
}

const props = defineProps<{
  subscriptions: NotificationSubscription[]
}>()

const emit = defineEmits<{
  'update:subscriptions': [NotificationSubscription[]]
}>()

const loading = ref(false)
const error = ref<string | null>(null)
const savingTargetKey = ref<string | null>(null)

/**
 * Server-wide kill switch for the scheduled-run email dispatch.
 * Optimistic default: `true` (no banner) before the first list()
 * resolves, so the page never flashes the deactivated state.
 */
const emailEnabled = ref<boolean | null>(null)

/**
 * The caller's user-principal id. Drives the "My personal agents"
 * row. `null` when the user has no user-principal yet (the SPA
 * hides the row in that case rather than rendering a dead toggle).
 */
const userPrincipalId = ref<number | null>(null)

const groups = ref<Awaited<ReturnType<typeof groupsApi.list>>>([])

onMounted(async () => {
  loading.value = true
  error.value = null
  try {
    // Single roundtrip: the controller now returns the user's
    // principal_id alongside the subscription list, so the SPA can
    // render the "My personal agents" row without a second call
    // to /auth/me.
    const res = await notificationSubscriptionsApi.list()
    emailEnabled.value = res.email_enabled
    userPrincipalId.value = res.user_principal_id
    // The subscriptions are emitted by the parent (AccountPage
    // owns them); this component only refreshes the in-memory list
    // after a subscribe/unsubscribe.
    void res.subscriptions

    groups.value = await groupsApi.list().catch(() => [] as Awaited<ReturnType<typeof groupsApi.list>>)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to load notification settings.'
  } finally {
    loading.value = false
  }
})

const groupTargets = computed<AvailableTarget[]>(() =>
  groups.value.map((g) => ({
    target_type: 'principal' as const,
    target_id: g.principal_id,
    label: g.name,
    hint: 'Every agent this group owns (current and future).',
  })),
)

const personalTargets = computed<AvailableTarget[]>(() => {
  if (userPrincipalId.value === null) return []
  return [{
    target_type: 'principal' as const,
    target_id: userPrincipalId.value,
    label: 'My personal agents',
    hint: 'Every agent you own directly.',
  }]
})

/**
 * Stable key per target — used to drive the per-row saving flag.
 */
function targetKey(t: AvailableTarget): string {
  return `${t.target_type}:${t.target_id}`
}

function isSubscribed(t: AvailableTarget): boolean {
  return props.subscriptions.some(
    (s) => s.target_type === t.target_type && s.target_id === t.target_id,
  )
}

async function toggle(t: AvailableTarget): Promise<void> {
  const key = targetKey(t)
  savingTargetKey.value = key
  error.value = null
  const wasSubscribed = isSubscribed(t)
  try {
    if (wasSubscribed) {
      await notificationSubscriptionsApi.unsubscribe(t)
      emit('update:subscriptions', props.subscriptions.filter(
        (s) => !(s.target_type === t.target_type && s.target_id === t.target_id),
      ))
    } else {
      await notificationSubscriptionsApi.subscribe(t)
      // Re-fetch the canonical list so the row carries the server-assigned id + created_at.
      const list = await notificationSubscriptionsApi.list()
      emit('update:subscriptions', list.subscriptions)
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to update subscription.'
  } finally {
    savingTargetKey.value = null
  }
}
</script>

<template>
  <section class="rounded-xl border border-border bg-card p-5 space-y-4">
    <div>
      <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Email Notifications · Scheduled Runs
      </h3>
      <p class="text-xs text-muted-foreground mt-2 leading-relaxed">
        Receive an email when a scheduled run completes. Tick a row to subscribe; untick to
        unsubscribe. Group-level subscriptions cover every agent the group owns (current and
        future).
      </p>
    </div>

    <div
      v-if="emailEnabled === false"
      role="alert"
      class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 leading-relaxed"
    >
      <p class="font-medium">Scheduled-run email is currently disabled on this server.</p>
      <p class="mt-1 text-amber-700/90 dark:text-amber-300/90">
        Your toggles below are still saved — they take effect the moment the operator
        re-enables dispatch. To turn it back on, set
        <code class="font-mono text-[0.7rem]">SPORA_NOTIFICATIONS_EMAIL_ENABLED=true</code>
        in the server's <code class="font-mono text-[0.7rem]">.env</code> and restart the worker.
      </p>
    </div>

    <div v-if="loading" class="text-sm text-muted-foreground">Loading…</div>
    <template v-else>
      <div
        v-if="groupTargets.length === 0 && personalTargets.length === 0"
        class="text-sm text-muted-foreground"
      >
        No groups to manage yet.
      </div>
      <div v-else class="space-y-2">
        <div v-if="personalTargets.length > 0" class="space-y-2">
          <p class="text-xs font-medium text-muted-foreground">My personal agents</p>
          <label
            v-for="t in personalTargets"
            :key="targetKey(t)"
            class="flex items-start justify-between gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/40 transition-colors"
          >
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate">{{ t.label }}</p>
              <p class="text-xs text-muted-foreground mt-0.5">{{ t.hint }}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span
                v-if="savingTargetKey === targetKey(t)"
                class="text-xs text-muted-foreground"
              >
                Saving…
              </span>
              <input
                type="checkbox"
                :checked="isSubscribed(t)"
                :disabled="savingTargetKey === targetKey(t)"
                @change="toggle(t)"
                class="h-4 w-4 rounded border-border bg-background text-primary focus:ring-1 focus:ring-ring disabled:opacity-50"
              />
            </div>
          </label>
        </div>
        <div v-if="groupTargets.length > 0" class="space-y-2">
          <p class="text-xs font-medium text-muted-foreground">Groups</p>
          <label
            v-for="t in groupTargets"
            :key="targetKey(t)"
            class="flex items-start justify-between gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/40 transition-colors"
          >
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate">{{ t.label }}</p>
              <p class="text-xs text-muted-foreground mt-0.5">{{ t.hint }}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span
                v-if="savingTargetKey === targetKey(t)"
                class="text-xs text-muted-foreground"
              >
                Saving…
              </span>
              <input
                type="checkbox"
                :checked="isSubscribed(t)"
                :disabled="savingTargetKey === targetKey(t)"
                @change="toggle(t)"
                class="h-4 w-4 rounded border-border bg-background text-primary focus:ring-1 focus:ring-ring disabled:opacity-50"
              />
            </div>
          </label>
        </div>
      </div>
    </template>

    <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
  </section>
</template>
