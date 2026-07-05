<script setup lang="ts">
/**
 * UpdatePluginModal — re-pin a plugin (identified by slug) to a new constraint,
 * or bump to latest matching the existing constraint. Empty constraint →
 * `composer update`; non-empty → `composer require <pkg>:<constraint>` which
 * both upgrades and pins.
 */
import { computed, ref, watch } from 'vue'
import { RefreshCw, X } from 'lucide-vue-next'
import { ApiError } from '@/api/client'
import { usePluginsStore } from '../stores/plugins'

const props = defineProps<{
  open: boolean
  slug: string
}>()

const emit = defineEmits<{
  close: []
  updated: [result: { package: string }]
}>()

const store = usePluginsStore()
const constraint = ref('')
const submitError = ref<string | null>(null)

const canSubmit = computed(() => !store.mutating)

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    constraint.value = ''
    submitError.value = null
  }
})

async function submit(): Promise<void> {
  submitError.value = null
  try {
    const trimmedConstraint = constraint.value.trim()
    const constraintIsEmpty = trimmedConstraint === ''
    const result = await store.update(props.slug, {
      ...(constraintIsEmpty ? {} : { constraint: trimmedConstraint }),
    })
    emit('updated', { package: result.package })
    emit('close')
  } catch (e) {
    submitError.value = e instanceof ApiError ? e.message : 'Update failed.'
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
        data-testid="update-plugin-modal"
        class="relative z-10 w-full max-w-md rounded-xl border border-border bg-background shadow-lg"
      >
        <header class="flex items-start justify-between gap-3 p-5 border-b border-border">
          <div class="flex items-center gap-2">
            <RefreshCw class="w-5 h-5 text-primary" />
            <h2 class="text-lg font-semibold">Update plugin</h2>
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
          <p class="text-sm text-foreground/80">
            Update
            <code class="font-mono">{{ slug }}</code>
            to the latest version.
          </p>

          <div>
            <label for="update-constraint" class="block text-xs font-medium text-muted-foreground mb-1">
              Re-pin to constraint <span class="font-normal text-muted-foreground/70">(optional)</span>
            </label>
            <input
              id="update-constraint"
              v-model="constraint"
              type="text"
              autocomplete="off"
              placeholder="^0.3"
              data-testid="update-constraint-input"
              class="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <p class="text-xs text-muted-foreground mt-1">
              Leave empty to keep the existing constraint. Set to re-pin (e.g.
              <code class="font-mono">^0.3</code>).
            </p>
          </div>

          <div v-if="submitError" class="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="update-error">
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
              data-testid="update-submit"
              class="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw class="w-3.5 h-3.5" />
              {{ store.mutating ? 'Updating…' : 'Update' }}
            </button>
          </footer>
        </form>
      </div>
    </div>
  </Teleport>
</template>