<script setup lang="ts">
/**
 * TemplateExportDialog — shows the inline "settings not exported" warning
 * and lets the operator download the agent's payload as a .json file.
 *
 * The backend's export endpoint already filters out passwords, API keys,
 * and per-agent tool settings. We surface that policy here so the operator
 * sees it before downloading.
 */
import { ref, watch } from 'vue'
import Modal from '@/components/Modal.vue'
import { useAgentTemplateStore } from '@/stores/agentTemplates'
import { ApiError } from '@/api/client'
import type { AgentTemplateExportResponse } from '@/types/agentTemplate'

const props = defineProps<{
  modelValue: boolean
  agentId: number
  agentName: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const store = useAgentTemplateStore()
const loading = ref(false)
const exporting = ref(false)
const error = ref<string | null>(null)
const result = ref<AgentTemplateExportResponse | null>(null)

watch(
  () => [props.modelValue, props.agentId] as const,
  async ([open, id]) => {
    // Refetch on every open — the agent's tools may have changed since last export.
    if (!open || !id) return
    loading.value = true
    error.value = null
    result.value = null
    try {
      result.value = await store.exportAgent(id)
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to load export.'
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

function download(): void {
  if (!result.value) return
  exporting.value = true
  try {
    const blob = new Blob([JSON.stringify(result.value.template, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${result.value.template.id}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } finally {
    exporting.value = false
  }
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    :title="`Export '${agentName}' as template`"
    size="md"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div v-if="loading" class="text-sm text-muted-foreground">Preparing export…</div>

    <p v-else-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>

    <div v-else-if="result" class="flex flex-col gap-4">
      <div
        role="alert"
        class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm flex gap-2"
      >
        <span class="text-amber-600 dark:text-amber-400 font-semibold shrink-0">⚠</span>
        <span>{{ result.inline_warning }}</span>
      </div>

      <dl class="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt class="text-xs uppercase tracking-wide text-muted-foreground">Template id</dt>
          <dd class="font-mono mt-0.5">{{ result.template.id }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-muted-foreground">Version</dt>
          <dd class="font-mono mt-0.5">{{ result.template.version }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-muted-foreground">Tools</dt>
          <dd class="font-mono mt-0.5">{{ result.template.tools.length }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-muted-foreground">Required plugins</dt>
          <dd class="font-mono mt-0.5">{{ result.template.required_plugins.length }}</dd>
        </div>
      </dl>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          @click="close"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Close
        </button>
        <button
          type="button"
          @click="download"
          :disabled="!result || exporting"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {{ exporting ? 'Downloading…' : 'Download .json' }}
        </button>
      </div>
    </template>
  </Modal>
</template>