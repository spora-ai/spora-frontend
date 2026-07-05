<script setup lang="ts">
/**
 * PluginsPage — root page for /apps/plugins. Renders the inventory grid and
 * wires up the install/uninstall/update modals. Admin + feature-flag gating
 * is cosmetic; the backend is the source of truth.
 */
import { onMounted, ref, computed } from 'vue'
import { Download, Puzzle, RefreshCw } from 'lucide-vue-next'
import GlobalNavbar from '@/components/GlobalNavbar.vue'
import { useAdminAuth } from '@/composables/useAdminAuth'
import { useFeatureEnabled } from '@/composables/useFeatureEnabled'
import { usePluginsStore } from '../stores/plugins'
import InstallPluginModal from '../components/InstallPluginModal.vue'
import PluginCard from '../components/PluginCard.vue'
import PluginDetailDialog from '../components/PluginDetailDialog.vue'
import UninstallPluginModal from '../components/UninstallPluginModal.vue'
import UpdatePluginModal from '../components/UpdatePluginModal.vue'
import type { PluginResource } from '../types/plugin'

const store = usePluginsStore()
const { isAdmin } = useAdminAuth()
const pluginInstallEnabled = useFeatureEnabled('plugin_install')

const selected = ref<PluginResource | null>(null)
const dialogOpen = ref(false)

const installOpen = ref(false)
const uninstallTarget = ref<string | null>(null)
const updateTarget = ref<string | null>(null)

onMounted(() => {
  store.load()
})

function openDetail(plugin: PluginResource): void {
  selected.value = plugin
  dialogOpen.value = true
}

function closeDetail(): void {
  dialogOpen.value = false
}

function openInstall(): void {
  installOpen.value = true
}
function closeInstall(): void {
  installOpen.value = false
}

function openUninstall(pkg: string): void {
  uninstallTarget.value = pkg
}
function closeUninstall(): void {
  uninstallTarget.value = null
}

function openUpdate(pkg: string): void {
  updateTarget.value = pkg
}
function closeUpdate(): void {
  updateTarget.value = null
}

function onCardAction(action: { type: 'uninstall' | 'update'; plugin: PluginResource }): void {
  if (action.type === 'uninstall') openUninstall(action.plugin.slug)
  if (action.type === 'update') openUpdate(action.plugin.slug)
}

const hasPlugins = computed(() => store.plugins.length > 0)

// Admins see install/uninstall/update affordances only when the server-side
// feature flag is on. The server returns 403 FEATURE_DISABLED if an admin
// calls the endpoint with the flag off — the modals catch that error.
const showInstallButton = computed(() => isAdmin.value && pluginInstallEnabled.value)
</script>

<template>
  <div class="min-h-screen bg-background flex flex-col">
    <GlobalNavbar />

    <main class="flex-1">
      <div class="max-w-6xl mx-auto px-4 py-8">
        <div class="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 class="text-2xl font-bold flex items-center gap-2">
              <Puzzle class="w-6 h-6 text-primary" />
              Plugins
            </h1>
            <p class="text-sm text-muted-foreground mt-1">
              Installed plugins and their migration status. Install via the
              button below, the CLI (<code class="text-xs font-mono">php bin/spora plugin:install</code>),
              or for path-based checkouts, drop a directory into
              <code class="text-xs font-mono">plugins/</code> or add it to
              <code class="text-xs font-mono">SPORA_PLUGINS_PATHS</code>.
            </p>
          </div>
          <div class="flex items-center gap-2">
            <button
              v-if="showInstallButton"
              type="button"
              @click="openInstall"
              data-testid="install-plugin-button"
              class="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:bg-primary/90 transition-colors"
            >
              <Download class="w-4 h-4" />
              Install plugin
            </button>
            <button
              type="button"
              @click="store.load()"
              :disabled="store.loading"
              class="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-background text-sm hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw class="w-4 h-4" :class="store.loading ? 'animate-spin' : ''" />
              Refresh
            </button>
          </div>
        </div>

        <div
          v-if="store.error"
          class="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm p-4 mb-6"
          data-testid="plugins-error"
        >
          {{ store.error }}
        </div>

        <div
          v-else-if="store.loading && !hasPlugins"
          class="text-sm text-muted-foreground"
        >
          Loading…
        </div>

        <div
          v-else-if="!hasPlugins"
          class="rounded-xl border border-dashed border-border bg-card p-12 text-center"
        >
          <Puzzle class="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h2 class="text-sm font-semibold mb-1">No plugins installed</h2>
          <p class="text-xs text-muted-foreground max-w-md mx-auto">
            Plugins extend Spora with additional tools, drivers, and recipes. Once a plugin is installed it will appear here.
          </p>
          <button
            v-if="showInstallButton"
            type="button"
            @click="openInstall"
            class="mt-4 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:bg-primary/90 transition-colors"
          >
            <Download class="w-4 h-4" />
            Install your first plugin
          </button>
        </div>

        <div
          v-else
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          <PluginCard
            v-for="plugin in store.plugins"
            :key="plugin.slug"
            :plugin="plugin"
            :show-actions="showInstallButton"
            @select="openDetail"
            @action="onCardAction"
          />
        </div>
      </div>
    </main>

    <PluginDetailDialog
      :open="dialogOpen"
      :plugin="selected"
      @close="closeDetail"
    />

    <InstallPluginModal
      :open="installOpen"
      @close="closeInstall"
    />

    <UninstallPluginModal
      v-if="uninstallTarget"
      :open="uninstallTarget !== null"
      :slug="uninstallTarget"
      @close="closeUninstall"
    />

    <UpdatePluginModal
      v-if="updateTarget"
      :open="updateTarget !== null"
      :slug="updateTarget"
      @close="closeUpdate"
    />
  </div>
</template>