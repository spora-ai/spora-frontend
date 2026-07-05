<script setup lang="ts">
/**
 * InstallPluginModal — collects {package, constraint?} and calls store.install().
 *
 * Mirrors docs/20_plugin_install_api.md § "POST /api/v1/plugins". Emits
 * `installed` with the PluginOperationResult so the parent can refresh its UI
 * (the store already reloads on success; the event is for cross-component
 * coordination like closing related dialogs).
 */
import { computed, ref, watch } from 'vue'
import { Download, X } from 'lucide-vue-next'
import { ApiError } from '@/api/client'
import { usePluginsStore } from '../stores/plugins'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  installed: [result: { package: string }]
}>()

const store = usePluginsStore()

const packageName = ref('')
const constraint = ref('')
const submitError = ref<string | null>(null)

const PACKAGE_REGEX = /^[a-z0-9]([_.\-a-z0-9]*[a-z0-9])?\/[a-z0-9]([_.\-a-z0-9]*[a-z0-9])?$/

const canSubmit = computed(() => PACKAGE_REGEX.test(packageName.value.trim()) && !store.mutating)

// Reset on open
watch(() => props.open, (isOpen) => {
  if (isOpen) {
    packageName.value = ''
    constraint.value = ''
    submitError.value = null
  }
})

async function submit(): Promise<void> {
  submitError.value = null
  try {
    const trimmedPackage = packageName.value.trim()
    const trimmedConstraint = constraint.value.trim()
    const constraintIsEmpty = trimmedConstraint === ''
    const result = await store.install({
      package: trimmedPackage,
      ...(constraintIsEmpty ? {} : { constraint: trimmedConstraint }),
    })
    emit('installed', { package: result.package })
    emit('close')
  } catch (e) {
    submitError.value = e instanceof ApiError ? e.message : 'Install failed.'
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
      @click.self="close"
    >
      <div class="absolute inset-0 bg-black/50" @click="close" />
      <div
        data-testid="install-plugin-modal"
        class="relative z-10 w-full max-w-lg rounded-xl border border-border bg-background shadow-lg"
      >
        <header class="flex items-start justify-between gap-3 p-5 border-b border-border">
          <div class="flex items-center gap-2">
            <Download class="w-5 h-5 text-primary" />
            <h2 class="text-lg font-semibold">Install plugin</h2>
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

        <form @submit.prevent="submit" class="p-5 space-y-4">
          <div>
            <label for="install-package" class="block text-xs font-medium text-muted-foreground mb-1">
              Composer package
            </label>
            <input
              id="install-package"
              v-model="packageName"
              type="text"
              required
              autocomplete="off"
              placeholder="spora-ai/spora-plugin-tavily"
              data-testid="install-package-input"
              class="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <p class="text-xs text-muted-foreground mt-1">
              Must match <code>vendor/name</code>. Browse the catalog (when available) for the full list.
            </p>
          </div>

          <div>
            <label for="install-constraint" class="block text-xs font-medium text-muted-foreground mb-1">
              Version constraint <span class="font-normal text-muted-foreground/70">(optional)</span>
            </label>
            <input
              id="install-constraint"
              v-model="constraint"
              type="text"
              autocomplete="off"
              placeholder="^0.2"
              data-testid="install-constraint-input"
              class="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <p class="text-xs text-muted-foreground mt-1">
              Semver constraint passed to <code>composer require</code>. Leave empty for latest.
            </p>
          </div>

          <div v-if="submitError" class="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="install-error">
            {{ submitError }}
          </div>

          <footer class="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              @click="close"
              class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="!canSubmit"
              data-testid="install-submit"
              class="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download class="w-3.5 h-3.5" />
              {{ store.mutating ? 'Installing…' : 'Install' }}
            </button>
          </footer>
        </form>
      </div>
    </div>
  </Teleport>
</template>