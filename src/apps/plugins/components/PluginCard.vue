<script setup lang="ts">
/**
 * PluginCard — single plugin summary in the inventory grid.
 *
 * The card body emits `select` on click. When `show-actions` is true (admin
 * + plugin install feature enabled), Update and Uninstall buttons appear
 * inline and stop propagation so they don't also open the detail dialog.
 */
import { Wrench, Cpu, FileText, RefreshCw, Trash2 } from 'lucide-vue-next'
import type { PluginResource } from '../types/plugin'
import Icon from '@/components/ui/Icon.vue'
import MigrationStatusBadge from './MigrationStatusBadge.vue'

defineProps<{
  plugin: PluginResource
  showActions?: boolean
}>()

const emit = defineEmits<{
  select: [plugin: PluginResource]
  action: [event: { type: 'update' | 'uninstall'; plugin: PluginResource }]
}>()

function emitUpdate(plugin: PluginResource, ev: Event): void {
  ev.stopPropagation()
  emit('action', { type: 'update', plugin })
}

function emitUninstall(plugin: PluginResource, ev: Event): void {
  ev.stopPropagation()
  emit('action', { type: 'uninstall', plugin })
}
</script>

<template>
  <div
    role="button"
    tabindex="0"
    class="text-left rounded-xl border border-border bg-card p-5 hover:border-primary/50 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
    @click="$emit('select', plugin)"
    @keydown.enter="$emit('select', plugin)"
    @keydown.space.prevent="$emit('select', plugin)"
  >
    <div class="flex items-start gap-3">
      <div class="rounded-lg bg-primary/10 p-2 shrink-0">
        <Icon :name="plugin.icon" class="w-5 h-5 text-primary" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-2">
          <h3 class="text-sm font-semibold truncate">{{ plugin.name }}</h3>
          <span
            v-if="plugin.version > 0"
            class="text-xs font-mono text-muted-foreground shrink-0"
            title="Plugin-declared schema version"
          >
            v{{ plugin.version }}
          </span>
        </div>
        <p class="text-xs text-muted-foreground mt-1 line-clamp-2 min-h-[2rem]">
          {{ plugin.description || `Plugin slug: ${plugin.slug}` }}
        </p>
      </div>
    </div>

    <div class="mt-4 flex items-center justify-between gap-2">
      <div class="flex items-center gap-3 text-xs text-muted-foreground">
        <span class="inline-flex items-center gap-1" :title="`${plugin.bundledTools.length} bundled tool(s)`">
          <Wrench class="w-3.5 h-3.5" />
          {{ plugin.bundledTools.length }}
        </span>
        <span class="inline-flex items-center gap-1" :title="`${plugin.bundledDrivers.length} bundled driver(s)`">
          <Cpu class="w-3.5 h-3.5" />
          {{ plugin.bundledDrivers.length }}
        </span>
        <span class="inline-flex items-center gap-1" :title="`${plugin.recipePaths.length} recipe path(s)`">
          <FileText class="w-3.5 h-3.5" />
          {{ plugin.recipePaths.length }}
        </span>
      </div>
      <MigrationStatusBadge
        :status="plugin.migrations.status"
        :pending="plugin.migrations.pending"
      />
    </div>

    <div v-if="showActions" class="mt-4 pt-3 border-t border-border flex items-center justify-end gap-1.5">
      <button
        type="button"
        :data-testid="`update-${plugin.slug}`"
        @click="emitUpdate(plugin, $event)"
        class="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Update plugin"
      >
        <RefreshCw class="w-3 h-3" />
        Update
      </button>
      <button
        type="button"
        :data-testid="`uninstall-${plugin.slug}`"
        @click="emitUninstall(plugin, $event)"
        class="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
        title="Uninstall plugin"
      >
        <Trash2 class="w-3 h-3" />
        Uninstall
      </button>
    </div>
  </div>
</template>