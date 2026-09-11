<script setup lang="ts">
/**
 * SpeechProviderConfigList — table-style list of speech provider configs
 * for a given scope. Each row shows the display name, provider class
 * display name, scope badge, and last-updated date. Clicking a row
 * emits `select` so the parent page can transition into edit view.
 *
 * The list is filtered by `scope`:
 *   - `global` → admin-owned configs visible on the admin page
 *   - `user`   → caller-owned configs on the user settings page
 *   - `group`  → group-owned configs on the Group settings page
 *   - `agent`  → caller-supplied `items` (the agent's tool override is
 *     not in the `/speech/provider-configs` envelope; the section
 *     renders it from its own fetch and passes the row in directly).
 */
import { computed } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { useSpeechProviderConfigsStore } from '@/stores/speechProviderConfigs'
import SpeechProviderScopeBadge from './SpeechProviderScopeBadge.vue'
import type { SpeechProviderConfig, SpeechProviderScope } from '@/types/speechProviderConfig'

const props = defineProps<{
  scope: SpeechProviderScope
  /** Used when scope === 'agent' — the section owns its own fetch and
   *  passes the row in directly so this list doesn't need to know about
   *  the per-agent tool override endpoint. */
  items?: SpeechProviderConfig[]
}>()

const emit = defineEmits<{
  select: [config: SpeechProviderConfig]
  create: []
}>()

const store = useSpeechProviderConfigsStore()

const visibleConfigs = computed<SpeechProviderConfig[]>(() => {
  if (props.scope === 'global') return store.globalConfigs
  if (props.scope === 'group') return store.groupConfigs
  if (props.scope === 'agent') return props.items ?? []
  return store.personalConfigs
})

const emptyMessage = computed<string>(() => {
  switch (props.scope) {
    case 'global':
      return 'No global speech provider configurations yet.'
    case 'group':
      return 'This group has no speech provider configurations yet.'
    case 'agent':
      return 'No speech provider override for this agent yet.'
    case 'user':
    default:
      return 'You have not configured a personal speech provider yet.'
  }
})

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
</script>

<template>
  <div
    v-if="store.loadingConfigs && (scope === 'global' || scope === 'user' || scope === 'group')"
    class="text-sm text-muted-foreground py-8 text-center"
  >
    Loading…
  </div>

  <template v-else>
    <div
      v-if="visibleConfigs.length === 0"
      class="rounded-xl border border-border bg-card divide-y divide-border"
    >
      <div class="px-5 py-8 text-center">
        <p class="text-sm text-muted-foreground mb-4">
          {{ emptyMessage }}
        </p>
        <button
          type="button"
          @click="emit('create')"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
        >
          Set up your first provider
        </button>
      </div>
    </div>

    <template v-else>
      <div class="rounded-xl border border-border bg-card divide-y divide-border">
        <button
          v-for="config in visibleConfigs"
          :key="config.id"
          type="button"
          @click="emit('select', config)"
          class="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/50 transition-colors"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium truncate">{{ config.display_name }}</span>
              <SpeechProviderScopeBadge :scope="config.scope" />
            </div>
            <p class="text-xs text-muted-foreground mt-0.5 truncate">
              {{ config.provider_display_name }}
            </p>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <span class="text-xs text-muted-foreground">
              Updated {{ formatDate(config.updated_at) }}
            </span>
            <ChevronRight class="h-4 w-4 text-muted-foreground" />
          </div>
        </button>
      </div>
      <div class="mt-4 flex justify-end">
        <button
          type="button"
          @click="emit('create')"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
        >
          + Add New
        </button>
      </div>
    </template>
  </template>
</template>
