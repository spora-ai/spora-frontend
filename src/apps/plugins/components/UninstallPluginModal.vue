<script setup lang="ts">
/**
 * UninstallPluginModal — confirms removal of a single plugin by Composer
 * package name. The package prop comes from `PluginResource.package` so the
 * server's vendor/name regex accepts it. `name` is the human-readable
 * plugin name (e.g. "Tavily") for the confirmation copy. Cancellation
 * keeps the plugin installed.
 */
import { computed, ref, watch } from 'vue'
import { Trash2, X } from 'lucide-vue-next'
import { ApiError } from '@/api/client'
import { usePluginsStore } from '../stores/plugins'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  /** Composer vendor/name (PluginResource.package). Null for plugins without a composer.json sidecar; the caller should not open this modal in that case. */
  package: string | null
  /** Human-readable plugin name (PluginResource.name) — used in the confirmation copy. */
  name?: string | null
}>()

const emit = defineEmits<{
  close: []
  uninstalled: [result: { package: string }]
}>()

const store = usePluginsStore()
const submitError = ref<string | null>(null)

const canSubmit = computed(() => !store.mutating)

watch(() => props.open, (isOpen) => {
  if (isOpen) submitError.value = null
})

async function submit(): Promise<void> {
  submitError.value = null
  if (!props.package) {
    // Defensive: callers should not open this modal without a Composer package.
    // PluginCard already hides the action buttons for null-package plugins.
    emit('close')
    return
  }
  try {
    const result = await store.uninstall(props.package)
    emit('uninstalled', { package: result.package })
    emit('close')
  } catch (e) {
    if (e instanceof ApiError && e.code === 'FEATURE_DISABLED') {
      submitError.value = t(
        'Plugin uninstall via the Web UI is disabled. Use the CLI: php bin/spora plugin:uninstall {package}.',
        { package: '<vendor/name>' },
      )
    } else {
      submitError.value = e instanceof ApiError ? e.message : t('Uninstall failed.')
    }
  }
}

function close(): void {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        :aria-label="t('Close dialog')"
        class="absolute inset-0 bg-black/50"
        @click="close"
      />
      <div
        data-testid="uninstall-plugin-modal"
        class="relative z-10 w-full max-w-md rounded-xl border border-border bg-background shadow-lg"
      >
        <header class="flex items-start justify-between gap-3 p-5 border-b border-border">
          <div class="flex items-center gap-2">
            <Trash2 class="w-5 h-5 text-destructive" />
            <h2 class="text-lg font-semibold">
              {{ t('Uninstall plugin') }}
            </h2>
          </div>
          <button
            type="button"
            @click="close"
            class="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            :aria-label="t('Close dialog')"
          >
            <X class="w-5 h-5" />
          </button>
        </header>

        <div class="p-5 space-y-4">
          <p class="text-sm text-foreground/80">
            {{ t('This will remove the') }}
            <strong class="font-semibold">{{ name ?? package }}</strong>
            {{ t('plugin (Composer package') }}
            <code class="font-mono text-foreground">{{ package }}</code>)
            {{ t('from this Spora install. You can re-install it later from the') }}
            <em>{{ t('Installed plugins') }}</em> {{ t('page\'s') }} <strong>{{ t('Install plugin') }}</strong>
            {{ t('button, or via the CLI:') }}
            <code class="font-mono text-xs">{{ 'php bin/spora plugin:install' }} {{ package }}</code>.
          </p>
          <p class="text-xs text-muted-foreground">
            {{ t('The plugin\'s Composer package is removed from') }} <code>{{ 'vendor/' }}</code>;
            {{ t('plugin-owned files outside') }} <code>{{ 'vendor/' }}</code> {{ t('are not touched.') }}
          </p>

          <div
            v-if="submitError"
            class="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            data-testid="uninstall-error"
          >
            {{ submitError }}
          </div>

          <footer class="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              @click="close"
              class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {{ t('Cancel') }}
            </button>
            <button
              type="button"
              :disabled="!canSubmit"
              @click="submit"
              data-testid="uninstall-submit"
              class="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-destructive px-4 text-sm font-medium text-destructive-foreground shadow-xs transition-colors hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 class="w-3.5 h-3.5" />
              {{ store.mutating ? t('Uninstalling…') : t('Uninstall') }}
            </button>
          </footer>
        </div>
      </div>
    </div>
  </Teleport>
</template>