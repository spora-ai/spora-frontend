<script setup lang="ts">
/**
 * CreateAgentFromTemplateModal — template gallery picker.
 *
 * Groups built-in + plugin-shipped templates by source (Core / Plugins),
 * shows the description + tool count for each, and emits `selected` with
 * the full template payload when the operator confirms.
 */
import { computed, onMounted, ref, useId, watch } from 'vue'
import Modal from '@/components/Modal.vue'
import Icon from '@/components/ui/Icon.vue'
import { useAgentTemplateStore } from '@/stores/agentTemplates'
import { ApiError } from '@/api/client'
import type { AgentTemplate, AgentTemplateSummary } from '@/types/agentTemplate'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  selected: [payload: { template: AgentTemplate; source: string }]
}>()

const store = useAgentTemplateStore()
const summary = ref<AgentTemplateSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const activeId = ref<string | null>(null)
const scope = useId()

async function loadList(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    summary.value = await store.fetchTemplates()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to load templates.'
  } finally {
    loading.value = false
  }
}

onMounted(loadList)
watch(() => props.modelValue, (open) => {
  if (open) loadList()
})

const grouped = computed(() => {
  const bySource = new Map<string, AgentTemplateSummary[]>()
  for (const t of summary.value) {
    const list = bySource.get(t.source) ?? []
    list.push(t)
    bySource.set(t.source, list)
  }
  return Array.from(bySource.entries()).sort(([a], [b]) => {
    if (a === 'core') return -1
    if (b === 'core') return 1
    return a.localeCompare(b)
  })
})

async function pickTemplate(t: AgentTemplateSummary): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const res = await store.getTemplate(t.id)
    activeId.value = t.id
    emit('selected', { template: res.template, source: res.source ?? t.source })
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to load template.'
  } finally {
    loading.value = false
  }
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    title="Create agent from template"
    size="lg"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div :id="`${scope}-template-gallery`" class="flex flex-col gap-4">
      <p class="text-sm text-muted-foreground">
        Templates bundle an agent's identity, system prompt, tool activations, and per-operation
        auto-approve defaults. Settings (passwords, API keys) are <strong>never</strong> included —
        configure them after creation.
      </p>

      <p
        v-if="error"
        role="alert"
        class="text-xs text-destructive"
      >{{ error }}</p>

      <div v-if="loading && summary.length === 0" class="text-sm text-muted-foreground">
        Loading templates…
      </div>

      <div v-else-if="!loading && summary.length === 0" class="text-sm text-muted-foreground">
        No templates available. Install a plugin or ship one with spora-core.
      </div>

      <div v-else class="flex flex-col gap-5">
        <section v-for="[source, items] in grouped" :key="source">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            {{ source === 'core' ? 'Core' : source }}
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              v-for="t in items"
              :key="t.id"
              type="button"
              :aria-pressed="activeId === t.id"
              :disabled="loading"
              @click="pickTemplate(t)"
              class="text-left rounded-lg border border-border bg-card p-4 hover:border-primary/50 disabled:opacity-50 transition-colors"
              :class="activeId === t.id ? 'border-primary ring-1 ring-primary/40' : ''"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-sm font-semibold truncate">{{ t.name }}</div>
                  <div class="text-xs text-muted-foreground mt-0.5">{{ t.id }} · v{{ t.version }}</div>
                </div>
                <span
                  v-if="t.has_warnings"
                  class="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold text-amber-600 dark:text-amber-400"
                  :title="`${t.required_plugins.length} plugin(s) required`"
                >
                  <Icon name="alert-triangle" class="h-3.5 w-3.5" />
                  {{ t.required_plugins.length > 0 ? `needs ${t.required_plugins.length}` : 'warnings' }}
                </span>
              </div>
              <p v-if="t.description" class="text-xs text-muted-foreground mt-2 line-clamp-2">
                {{ t.description }}
              </p>
              <div class="mt-3 text-[10px] uppercase tracking-wide text-muted-foreground">
                {{ t.tools_count }} tool{{ t.tools_count === 1 ? '' : 's' }}
                <span v-if="t.required_plugins.length > 0">
                  · {{ t.required_plugins.length }} plugin{{ t.required_plugins.length === 1 ? '' : 's' }}
                </span>
              </div>
            </button>
          </div>
        </section>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end">
        <button
          type="button"
          @click="close"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Close
        </button>
      </div>
    </template>
  </Modal>
</template>