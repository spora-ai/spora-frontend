<script setup lang="ts">
/**
 * PromptTemplateDialog — overlay dialog for creating prompt templates.
 *
 * Detects {{variable}} and {{variable:default}} patterns in the prompt text,
 * shows editable fields for user variables, and auto-fills system variables
 * (current_time, current_date, current_datetime).
 */
import { ref, computed, useId, watch } from 'vue'
import Modal from '@/components/Modal.vue'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import { usePromptTemplatesStore } from '@/stores/promptTemplates'
import { ApiError } from '@/api/client'
import { detectVariables, buildTemplatePayload, seedSystemVariableValues } from '@/composables/usePromptTemplateVars'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

/**
 * The system variables a prompt template may fill in.
 *
 * Not catalogue keys: they are the names the template engine looks for, so
 * they are identifiers rather than copy and stay in English in every
 * language.
 */
const CURRENT_DATE = 'current_date'
const CURRENT_TIME = 'current_time'
const CURRENT_DATETIME = 'current_datetime'

const props = defineProps<{
  modelValue: boolean
  agentId: number
  /** The current prompt text to save as a template */
  initialPrompt: string
  existingTemplateId?: number | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** Fired with the created PromptTemplateResource on success */
  saved: [template: import('@/types/promptTemplate').PromptTemplateResource]
}>()

const promptTemplatesStore = usePromptTemplatesStore()

// Per-instance id scope so multiple PromptTemplateDialogs never collide on
// `tmpl-name` / `tmpl-prompt` / per-variable ids (web:S1117).
const scope = useId()
const nameId = `${scope}-tmpl-name`
const promptId = `${scope}-tmpl-prompt`
const varId = (key: string): string => `${scope}-tmpl-var-${key}`

const formName = ref('')
const formPrompt = ref('')
const variableValues = ref<Record<string, string>>({})
const saving = ref(false)
const saveError = ref<string | null>(null)

const detectedVars = computed(() => detectVariables(formPrompt.value))

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      if (props.existingTemplateId) {
        const existing = promptTemplatesStore.templates.find(t => t.id === props.existingTemplateId)
        formName.value = existing?.name ?? ''
      } else {
        formName.value = ''
      }
      formPrompt.value = props.initialPrompt
      variableValues.value = {}
      saveError.value = null
      Object.assign(variableValues.value, seedSystemVariableValues())
    }
  },
)

async function save(overwrite: boolean = false): Promise<void> {
  if (!formName.value.trim() || !formPrompt.value.trim()) return
  if (!Number.isFinite(props.agentId)) return

  saving.value = true
  saveError.value = null
  try {
    const payload = buildTemplatePayload({
      name: formName.value,
      promptTemplate: formPrompt.value,
      variables: detectedVars.value,
      values: variableValues.value,
    })

    let template;
    if (overwrite && props.existingTemplateId) {
      template = await promptTemplatesStore.updateTemplate(props.agentId, props.existingTemplateId, payload)
    } else {
      template = await promptTemplatesStore.createTemplate(props.agentId, payload)
    }

    emit('saved', template)
    emit('update:modelValue', false)
  } catch (e) {
    saveError.value = e instanceof ApiError ? e.message : t('Failed to save template.')
  } finally {
    saving.value = false
  }
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    :title="t('Save as Template')"
    size="md"
    @update:model-value="(v) => !v && close()"
    @close="close"
  >
    <div class="flex flex-col gap-4">
      <p
        v-if="saveError"
        role="alert"
        class="text-xs text-destructive"
      >
        {{ saveError }}
      </p>


      <div class="flex flex-col gap-1.5">
        <label
          :for="nameId"
          class="text-sm font-medium"
        >{{ t('Template name') }}</label>
        <input
          :id="nameId"
          v-model="formName"
          type="text"
          :placeholder="t('My Research Template')"
          autocomplete="off"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
      </div>


      <div class="flex flex-col gap-1.5">
        <label
          :for="promptId"
          class="text-sm font-medium"
        >{{ t('Prompt template') }}</label>
        <MarkdownEditor
          :id="promptId"
          v-model="formPrompt"
          mode="bubble"
          :rows="5"
          :placeholder="t('Write your prompt here. Use \\{\\{variable\\}\\} or \\{\\{variable:default\\}\\} for variables.')"
        />
        <p class="text-xs text-muted-foreground">
          {{ t('Use') }} <code class="px-1 rounded bg-muted text-xs">{'{{ '}variable{' }}'}</code> {{ t('or') }}
          <code class="px-1 rounded bg-muted text-xs">{'{{ '}variable:default{' }}'}</code> {{ t('for variables.') }}
          {{ t('System variables are auto-filled:') }} <code class="px-1 rounded bg-muted text-xs">{{ CURRENT_DATE }}</code>,
          <code class="px-1 rounded bg-muted text-xs">{{ CURRENT_TIME }}</code>,
          <code class="px-1 rounded bg-muted text-xs">{{ CURRENT_DATETIME }}</code>.
        </p>
      </div>


      <div
        v-if="detectedVars.length > 0"
        class="flex flex-col gap-3"
      >
        <h3 class="text-sm font-semibold">
          {{ t('Variables') }}
        </h3>
        <div
          v-for="v in detectedVars"
          :key="v.key"
          class="flex flex-col gap-1.5"
        >
          <label
            :for="varId(v.key)"
            class="text-sm font-medium flex items-center gap-2"
          >
            {{ v.key }}
            <span
              v-if="v.isSystem"
              class="text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
            >{{ t('system') }}</span>
            <span
              v-if="v.defaultValue"
              class="text-xs font-normal text-muted-foreground"
            >{{ t('default:') }} {{ v.defaultValue }}</span>
          </label>
          <input
            :id="varId(v.key)"
            v-model="variableValues[v.key]"
            type="text"
            :placeholder="v.defaultValue || (v.isSystem ? t('(auto-filled)') : '')"
            :disabled="v.isSystem"
            class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-ring"
          >
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <button
          @click="close"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          type="button"
        >
          {{ t('Cancel') }}
        </button>
        <template v-if="props.existingTemplateId">
          <button
            @click="save(false)"
            :disabled="saving || !formName.trim() || !formPrompt.trim()"
            class="inline-flex h-9 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground shadow-xs transition-colors hover:bg-secondary/80 disabled:pointer-events-none disabled:opacity-50"
            type="button"
          >
            {{ t('Save as New') }}
          </button>
          <button
            @click="save(true)"
            :disabled="saving || !formName.trim() || !formPrompt.trim()"
            class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            type="button"
          >
            {{ t('Update') }}
          </button>
        </template>
        <template v-else>
          <button
            @click="save(false)"
            :disabled="saving || !formName.trim() || !formPrompt.trim()"
            class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            type="button"
          >
            {{ t('Save') }}
          </button>
        </template>
      </div>
    </template>
  </Modal>
</template>
