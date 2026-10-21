<script setup lang="ts">
/**
 * PluginsPage — root page for the /apps/plugins route.
 *
 * Tabbed shell: "Installed" (existing inventory + install/uninstall/update
 * buttons from A4) and "Browse" (Packagist-backed catalog from v0.7.0).
 *
 * The tablist is hidden outright when `SPORA_PLUGIN_CATALOG_ENABLED` is false.
 * It used to be shown regardless and left to surface the catalog endpoint's API
 * error — which asks the operator to click something that cannot work. With
 * one view there is nothing to switch between, so the switcher would be a
 * control with a single state.
 */
import { onMounted, ref, computed, watch } from 'vue'
import { AlertTriangle, Download, Lock, Puzzle, RefreshCw, Store } from 'lucide-vue-next'
import GlobalNavbar from '@/components/GlobalNavbar.vue'
import { useAdminAuth } from '@/composables/useAdminAuth'
import { useFeatureEnabled } from '@/composables/useFeatureEnabled'
import { usePluginsStore } from '../stores/plugins'
import BrowseStorePanel from '../components/BrowseStorePanel.vue'
import InstallPluginModal from '../components/InstallPluginModal.vue'
import PluginCard from '../components/PluginCard.vue'
import PluginDetailDialog from '../components/PluginDetailDialog.vue'
import UninstallPluginModal from '../components/UninstallPluginModal.vue'
import UpdatePluginModal from '../components/UpdatePluginModal.vue'
import type { PluginResource } from '../types/plugin'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

/**
 * The commands and paths the operator is told to run by hand.
 *
 * Not catalogue keys: a command, a path and an environment variable are
 * identifiers, and a translated one would name a command rather than be it.
 */
const PLUGIN_INSTALL_COMMAND = 'php bin/spora plugin:install <vendor/package>'
const PLUGIN_INSTALL_COMMAND_NAME = 'php bin/spora plugin:install <vendor/name>'
const PLUGINS_PATH = 'plugins/'
const PLUGINS_PATHS_ENV = 'SPORA_PLUGINS_PATHS'
const PLUGIN_INSTALL_ENABLED_ENV = 'SPORA_PLUGIN_INSTALL_ENABLED=true'

const store = usePluginsStore()
const { isAdmin } = useAdminAuth()
const pluginInstallEnabled = useFeatureEnabled('plugin_install')
const pluginCatalogEnabled = useFeatureEnabled('plugin_catalog')

const selected = ref<PluginResource | null>(null)
const dialogOpen = ref(false)

const installOpen = ref(false)
const installPackage = ref<string | null>(null)
const uninstallTarget = ref<PluginResource | null>(null)
const updateTarget = ref<PluginResource | null>(null)

type Tab = 'installed' | 'browse'
const activeTab = ref<Tab>('installed')

/**
 * Turning the catalog off while the Browse view is open would otherwise leave
 * the operator on a tab that no longer has a switcher and whose endpoint
 * refuses. The flag is read per session, so this fires on a config change rather
 * than a page load — but the fallback is what keeps the two consistent.
 */
watch(pluginCatalogEnabled, (enabled) => {
  if (!enabled && activeTab.value === 'browse') activeTab.value = 'installed'
})

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
/**
 * Open the install modal pre-filled with `pkg` (used by the Browse tab cards
 * and by the companion-plugin cards inside `PluginDetailDialog`). Switching
 * to the Installed tab before opening the modal means the user lands on a
 * view that will reflect the new plugin as soon as the modal closes.
 */
function openInstallWithPackage(pkg: string): void {
  installPackage.value = pkg
  installOpen.value = true
  activeTab.value = 'installed'
}
function closeInstall(): void {
  installOpen.value = false
  installPackage.value = null
}

function openUninstall(plugin: PluginResource): void {
  uninstallTarget.value = plugin
}
function closeUninstall(): void {
  uninstallTarget.value = null
}

function openUpdate(plugin: PluginResource): void {
  updateTarget.value = plugin
}
function closeUpdate(): void {
  updateTarget.value = null
}

function onCardAction(action: { type: 'uninstall' | 'update'; plugin: PluginResource }): void {
  if (action.type === 'uninstall') openUninstall(action.plugin)
  if (action.type === 'update') openUpdate(action.plugin)
}

const hasPlugins = computed(() => store.plugins.length > 0)

// Admins see install/uninstall/update affordances only when the server-side
// feature flag is on. The server returns 403 FEATURE_DISABLED if an admin
// calls the endpoint with the flag off — the modals catch that error.
const showInstallButton = computed(() => isAdmin.value && pluginInstallEnabled.value)

// Called after a successful install / uninstall / update — refresh the
// inventory so the Installed tab reflects the new state. The tab flip is
// handled before opening the modal in the Browse flow, so this only needs
// to reload.
function onAnyMutationCompleted(): void {
  store.load().catch(() => undefined)
}

function onCatalogInstall(pkg: string): void {
  openInstallWithPackage(pkg)
}
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
              {{ t('Plugins') }}
            </h1>
            <p class="text-sm text-muted-foreground mt-1">
              {{ t('Installed plugins and the Packagist catalog of available Spora plugins. Install with') }}
              <code class="text-xs font-mono">{{ PLUGIN_INSTALL_COMMAND }}</code>
              {{ t('— or for path-based checkouts, drop a directory into') }}
              <code class="text-xs font-mono">{{ PLUGINS_PATH }}</code> {{ t('or add it to') }}
              <code class="text-xs font-mono">{{ PLUGINS_PATHS_ENV }}</code>.
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              v-if="activeTab === 'installed' && showInstallButton"
              type="button"
              @click="openInstall"
              data-testid="install-plugin-button"
              class="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium shadow-xs hover:bg-primary/90 transition-colors whitespace-nowrap"
            >
              <Download class="w-4 h-4" />
              {{ t('Install plugin') }}
            </button>
            <button
              v-if="activeTab === 'installed'"
              type="button"
              @click="store.load()"
              :disabled="store.loading"
              data-testid="refresh-plugins-button"
              class="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-background text-sm hover:bg-muted transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw
                class="w-4 h-4"
                :class="store.loading ? 'animate-spin' : ''"
              />
              {{ t('Refresh') }}
            </button>
          </div>
        </div>

        <output
          v-if="isAdmin && !pluginInstallEnabled"
          class="block rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm p-4 mb-6 flex items-start gap-3"
          data-testid="plugin-install-disabled-banner"
        >
          <AlertTriangle
            class="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <span>
            <span class="block font-medium">{{ t('Plugin install, uninstall, and update via the Web UI are disabled.') }}</span>
            <span class="block text-muted-foreground mt-1">
              {{ t('Use the CLI instead:') }}
              <code class="text-xs font-mono">{{ PLUGIN_INSTALL_COMMAND_NAME }}</code>.
              {{ t('To enable in the admin UI, set') }}
              <code class="text-xs font-mono">{{ PLUGIN_INSTALL_ENABLED_ENV }}</code> {{ t('on the server.') }}
            </span>
          </span>
        </output>

        <output
          v-if="!isAdmin"
          class="block rounded-lg border border-border bg-card text-sm p-4 mb-6 flex items-start gap-3"
          data-testid="plugins-admin-only-note"
          aria-live="polite"
        >
          <Lock
            class="w-5 h-5 text-muted-foreground shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <span>
            <span class="block font-medium">{{ t('Install, uninstall, and update are restricted to administrators.') }}</span>
            <span class="block text-muted-foreground mt-1">
              {{ t('Your account has read-only access to this page. Ask a server admin to install, update, or remove plugins.') }}
            </span>
          </span>
        </output>

        <!--
          One view means one control. Hiding the switcher entirely says the
          catalog is off; leaving it up would invite a click that cannot work,
          and the API error it ends in explains nothing about why.
        -->
        <div
          v-if="pluginCatalogEnabled"
          role="tablist"
          :aria-label="t('Plugin views')"
          class="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-muted p-1 mb-6"
          data-testid="plugins-tablist"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="activeTab === 'installed'"
            @click="activeTab = 'installed'"
            data-testid="tab-installed"
            class="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm font-medium transition-colors"
            :class="activeTab === 'installed'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'"
          >
            <Puzzle class="w-3.5 h-3.5" />
            {{ t('Installed') }}
            <span
              v-if="hasPlugins"
              class="ml-1 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-muted-foreground/20 text-[10px] font-mono"
            >
              {{ store.plugins.length }}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activeTab === 'browse'"
            @click="activeTab = 'browse'"
            data-testid="tab-browse"
            class="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm font-medium transition-colors"
            :class="activeTab === 'browse'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'"
          >
            <Store class="w-3.5 h-3.5" />
            {{ t('Browse') }}
          </button>
        </div>

        <div
          v-if="activeTab === 'installed'"
          data-testid="plugins-installed-panel"
        >
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
            {{ t('Loading…') }}
          </div>

          <div
            v-else-if="!hasPlugins"
            class="rounded-xl border border-dashed border-border bg-card p-12 text-center"
          >
            <Puzzle class="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h2 class="text-sm font-semibold mb-1">
              {{ t('No plugins installed') }}
            </h2>
            <p class="text-xs text-muted-foreground max-w-md mx-auto">
              {{ t('Plugins extend Spora with additional tools, drivers, and recipes. The') }}
              <strong>{{ t('Browse') }}</strong> {{ t("tab lists what's available on Packagist — copy a package name and install it via") }}
              <code class="text-xs font-mono">{{ PLUGIN_INSTALL_COMMAND }}</code>
              {{ t('(see the README).') }}
            </p>
            <button
              v-if="showInstallButton"
              type="button"
              @click="openInstall"
              class="mt-4 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium shadow-xs hover:bg-primary/90 transition-colors"
            >
              <Download class="w-4 h-4" />
              {{ t('Install your first plugin') }}
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

        <div v-else-if="pluginCatalogEnabled">
          <BrowseStorePanel
            :show-install-button="showInstallButton"
            @install="onCatalogInstall"
          />
        </div>
      </div>
    </main>

    <PluginDetailDialog
      :open="dialogOpen"
      :plugin="selected"
      :show-install-button="showInstallButton"
      @close="closeDetail"
      @installed="onAnyMutationCompleted"
    />

    <InstallPluginModal
      :open="installOpen"
      :package="installPackage"
      @close="closeInstall"
      @installed="onAnyMutationCompleted"
    />

    <UninstallPluginModal
      v-if="uninstallTarget"
      :open="uninstallTarget !== null"
      :package="uninstallTarget.package"
      :name="uninstallTarget.name"
      @close="closeUninstall"
    />

    <UpdatePluginModal
      v-if="updateTarget"
      :open="updateTarget !== null"
      :package="updateTarget.package"
      @close="closeUpdate"
    />
  </div>
</template>