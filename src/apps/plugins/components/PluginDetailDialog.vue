<script setup lang="ts">
/**
 * PluginDetailDialog — full metadata for a single plugin.
 *
 * Read-only: shows the same fields as the card plus the absolute plugin path,
 * recipe paths, the breakdown of the migration status, and — when the plugin
 * declares a `suggest` map — a "Companion plugins" card with one-click
 * install buttons (deep-links the InstallPluginModal with a pre-filled
 * `package`).
 */
import { X, Wrench, Cpu, FileText, FolderOpen, Hash, Sparkles, Download } from 'lucide-vue-next'
import type { PluginResource } from '../types/plugin'
import MigrationStatusBadge from './MigrationStatusBadge.vue'
import InstallPluginModal from './InstallPluginModal.vue'
import { ref } from 'vue'

defineProps<{
  open: boolean
  plugin: PluginResource | null
}>()

const emit = defineEmits<{
  close: []
  installed: [result: { package: string }]
}>()

const installTarget = ref<string | null>(null)

function close(): void {
  emit('close')
}

function formatDate(iso: string | null): string {
  if (iso === null) return 'never'
  // The backend stores updated_at as Y-m-d H:i:s (server timezone). Surface it raw.
  return iso
}

function openInstallFor(packageName: string): void {
  installTarget.value = packageName
}
function closeInstall(): void {
  installTarget.value = null
}
function onInstalled(result: { package: string }): void {
  installTarget.value = null
  emit('installed', result)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && plugin"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      @click.self="close"
    >
      <div class="absolute inset-0 bg-black/50" @click="close" />
      <div
        data-testid="plugin-detail-dialog"
        class="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-border bg-background shadow-lg"
      >
        <header class="flex items-start justify-between gap-3 p-5 border-b border-border">
          <div>
            <h2 class="text-lg font-semibold">{{ plugin.name }}</h2>
            <p class="text-xs text-muted-foreground mt-0.5 font-mono">{{ plugin.slug }}</p>
          </div>
          <button
            type="button"
            @click="close"
            class="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Close dialog"
          >
            <X class="w-5 h-5" />
          </button>
        </header>

        <div class="flex-1 overflow-y-auto p-5 space-y-5">
          <p v-if="plugin.description" class="text-sm text-foreground/80">
            {{ plugin.description }}
          </p>

          <section v-if="plugin.suggests && Object.keys(plugin.suggests).length > 0">
            <h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              <Sparkles class="w-3.5 h-3.5" />
              Companion plugins ({{ Object.keys(plugin.suggests).length }})
            </h3>
            <ul class="space-y-2" data-testid="plugin-suggests-list">
              <li
                v-for="(description, packageName) in plugin.suggests"
                :key="packageName"
                class="flex items-center gap-3 rounded-lg border border-border bg-background p-3"
                :data-testid="`plugin-suggest-${packageName}`"
              >
                <div class="min-w-0 flex-1">
                  <code class="text-xs font-mono break-all">{{ packageName }}</code>
                  <p class="text-xs text-muted-foreground mt-1">{{ description }}</p>
                </div>
                <button
                  type="button"
                  @click="openInstallFor(packageName)"
                  :data-testid="`plugin-suggest-install-${packageName}`"
                  class="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium shadow-sm hover:bg-primary/90 transition-colors shrink-0"
                >
                  <Download class="w-3.5 h-3.5" />
                  Install
                </button>
              </li>
            </ul>
            <p class="text-xs text-muted-foreground mt-2">
              Sourced from <code class="font-mono">composer.json</code>'s <code class="font-mono">suggest</code> field.
            </p>
          </section>

          <section v-if="plugin.bundledTools.length > 0">
            <h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              <Wrench class="w-3.5 h-3.5" />
              Bundled tools ({{ plugin.bundledTools.length }})
            </h3>
            <ul class="space-y-1.5">
              <li
                v-for="tool in plugin.bundledTools"
                :key="tool.name"
                class="rounded-lg border border-border bg-background p-3"
              >
                <div class="flex items-center gap-2">
                  <Hash class="w-3 h-3 text-muted-foreground" />
                  <code class="text-xs font-mono">{{ plugin.slug }}:{{ tool.name }}</code>
                </div>
                <p class="text-xs text-muted-foreground mt-1">{{ tool.description }}</p>
              </li>
            </ul>
          </section>

          <section v-if="plugin.bundledDrivers.length > 0">
            <h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              <Cpu class="w-3.5 h-3.5" />
              Bundled drivers ({{ plugin.bundledDrivers.length }})
            </h3>
            <ul class="space-y-1.5">
              <li
                v-for="driver in plugin.bundledDrivers"
                :key="driver.provider"
                class="rounded-lg border border-border bg-background p-3 text-xs"
              >
                <div class="font-medium">{{ driver.provider }}</div>
                <code class="text-muted-foreground">{{ driver.class }}</code>
              </li>
            </ul>
          </section>

          <section v-if="plugin.recipePaths.length > 0">
            <h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              <FileText class="w-3.5 h-3.5" />
              Recipe paths
            </h3>
            <ul class="space-y-1 text-xs font-mono">
              <li v-for="path in plugin.recipePaths" :key="path" class="rounded border border-border bg-background px-2 py-1.5">
                {{ path }}
              </li>
            </ul>
          </section>

          <section>
            <h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Migrations
            </h3>
            <div class="rounded-lg border border-border bg-background p-3 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted-foreground">Status</span>
                <MigrationStatusBadge :status="plugin.migrations.status" :pending="plugin.migrations.pending" />
              </div>
              <dl class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <dt class="text-muted-foreground">Declared version</dt>
                <dd class="font-mono text-right">{{ plugin.migrations.declared }}</dd>
                <dt class="text-muted-foreground">Files on disk</dt>
                <dd class="font-mono text-right">{{ plugin.migrations.filesOnDisk }}</dd>
                <dt class="text-muted-foreground">Applied</dt>
                <dd class="font-mono text-right">{{ plugin.migrations.applied }}</dd>
                <dt class="text-muted-foreground">Pending</dt>
                <dd class="font-mono text-right">{{ plugin.migrations.pending }}</dd>
                <dt class="text-muted-foreground">Last applied</dt>
                <dd class="text-right">{{ formatDate(plugin.migrations.lastAppliedAt) }}</dd>
              </dl>
            </div>
          </section>

          <section v-if="plugin.path">
            <h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              <FolderOpen class="w-3.5 h-3.5" />
              Plugin path
            </h3>
            <code class="block text-xs font-mono rounded-lg border border-border bg-background px-3 py-2 break-all">
              {{ plugin.path }}
            </code>
          </section>
        </div>
      </div>
    </div>

    <InstallPluginModal
      v-if="installTarget !== null"
      :open="installTarget !== null"
      :package="installTarget"
      @close="closeInstall"
      @installed="onInstalled"
    />
  </Teleport>
</template>
