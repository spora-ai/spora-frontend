<script setup lang="ts">
/**
 * TemplateExportDialog — 2-step export flow.
 *
 * Step 1 — operator chooses between:
 *   - "Without settings"      → current behaviour (no per-agent overrides)
 *   - "Include settings"      → adds tool settings blocks, no secrets
 * Step 2 — review the payload, see warnings/info, download the .json.
 *
 * The backend's export endpoint already filters out passwords, API keys,
 * and inherited global/user values. The choice in step 1 just controls
 * whether the `?include_settings=1` query string is sent.
 */
import { computed, ref, watch } from 'vue'
import { Check } from 'lucide-vue-next'
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
type Step = 'choose' | 'review'
const step = ref<Step>('choose')
const includeSettings = ref(false)
const loading = ref(false)
const exporting = ref(false)
const error = ref<string | null>(null)
const result = ref<AgentTemplateExportResponse | null>(null)

const settingsCount = computed(
  () => result.value?.template.tools.filter((t) => t.settings && Object.keys(t.settings).length > 0).length ?? 0,
)

watch(
  () => [props.modelValue, props.agentId] as const,
  ([open]) => {
    // On open, always land on step 1 with a clean slate — don't auto-fetch.
    if (!open) return
    step.value = 'choose'
    includeSettings.value = false
    error.value = null
    result.value = null
  },
  { immediate: true },
)

async function pickOption(value: boolean): Promise<void> {
  includeSettings.value = value
  await fetchExport()
}

async function fetchExport(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    result.value = await store.exportAgent(props.agentId, includeSettings.value)
    step.value = 'review'
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to load export.'
  } finally {
    loading.value = false
  }
}

function backToChoose(): void {
  step.value = 'choose'
  result.value = null
  error.value = null
}

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
    <!-- STEP 1: choose ------------------------------------------------- -->
    <div v-if="step === 'choose'" class="flex flex-col gap-4">
      <p class="text-sm text-muted-foreground">
        Choose what to include in the template. You can review the payload
        before downloading.
      </p>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button
          type="button"
          :aria-pressed="includeSettings === false && loading === false"
          :disabled="loading"
          class="text-left rounded-xl border bg-card p-5 transition-colors flex flex-col gap-3 focus:outline-none focus:ring-2 focus:ring-ring"
          :class="
            includeSettings === false && !loading
              ? 'border-primary ring-2 ring-primary'
              : 'border-border hover:border-primary/50 disabled:opacity-60'
          "
          @click="pickOption(false)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="text-sm font-semibold">Without settings</div>
            <Check
              v-if="includeSettings === false && !loading"
              class="h-4 w-4 text-primary shrink-0"
              aria-hidden="true"
            />
          </div>
          <p class="text-xs text-muted-foreground">
            Just the agent definition, enabled tools, and operations. Best
            for sharing widely without exposing any configuration.
          </p>
        </button>

        <button
          type="button"
          :aria-pressed="includeSettings === true && loading === false"
          :disabled="loading"
          class="text-left rounded-xl border bg-card p-5 transition-colors flex flex-col gap-3 focus:outline-none focus:ring-2 focus:ring-ring"
          :class="
            includeSettings === true && !loading
              ? 'border-primary ring-2 ring-primary'
              : 'border-border hover:border-primary/50 disabled:opacity-60'
          "
          @click="pickOption(true)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="text-sm font-semibold">Include settings (no secrets)</div>
            <Check
              v-if="includeSettings === true && !loading"
              class="h-4 w-4 text-primary shrink-0"
              aria-hidden="true"
            />
          </div>
          <p class="text-xs text-muted-foreground">
            Adds agent-specific tool settings like the active skill
            allowlist. API keys and inherited values are NOT included.
          </p>
        </button>
      </div>

      <p v-if="loading" class="text-sm text-muted-foreground">
        Preparing export…
      </p>
      <p v-else-if="error" role="alert" class="text-sm text-destructive">
        {{ error }}
      </p>
    </div>

    <!-- STEP 2: review ------------------------------------------------- -->
    <div v-else-if="step === 'review'" class="flex flex-col gap-4">
      <div
        v-if="result?.inline_info"
        role="status"
        class="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm flex gap-2"
      >
        <span class="text-blue-600 dark:text-blue-400 font-semibold shrink-0">ⓘ</span>
        <span>{{ result.inline_info }}</span>
      </div>

      <div
        v-if="result?.inline_warning"
        role="alert"
        class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm flex gap-2"
      >
        <span class="text-amber-600 dark:text-amber-400 font-semibold shrink-0">⚠</span>
        <span>{{ result.inline_warning }}</span>
      </div>

      <dl v-if="result" class="grid grid-cols-2 gap-3 text-sm">
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
        <div v-if="includeSettings && settingsCount > 0" class="col-span-2">
          <dt class="text-xs uppercase tracking-wide text-muted-foreground">Agent settings</dt>
          <dd class="font-mono mt-0.5">{{ settingsCount }} tool(s)</dd>
        </div>
      </dl>
    </div>

    <template #footer>
      <!-- STEP 1 footer -->
      <div v-if="step === 'choose'" class="flex justify-end gap-2">
        <button
          type="button"
          @click="close"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors disabled:opacity-50"
        >
          Continue
        </button>
      </div>

      <!-- STEP 2 footer -->
      <div v-else class="flex justify-end gap-2">
        <button
          type="button"
          @click="backToChoose"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Back
        </button>
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