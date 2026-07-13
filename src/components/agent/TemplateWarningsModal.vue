<script setup lang="ts">
/**
 * TemplateWarningsModal — preview of template warnings before import.
 *
 * Three sections:
 *   1. Missing plugins (links to the plugins page)
 *   2. Tools that need configuration (links to Settings → Tools)
 *   3. Generic warnings (e.g. SYSTEM_PROMPT_MISSING)
 *
 * Operator can cancel or "Import anyway". The parent is responsible for
 * actually calling the import endpoint and routing to the new agent.
 */
import { computed } from 'vue'
import Modal from '@/components/Modal.vue'
import Icon from '@/components/ui/Icon.vue'
import type { TemplateWarning } from '@/types/agentTemplate'

const props = defineProps<{
  modelValue: boolean
  templateName: string
  warnings: TemplateWarning[]
  submitting?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
}>()

const pluginWarnings = computed(() => props.warnings.filter((w) => w.code === 'PLUGIN_MISSING'))
const toolConfigWarnings = computed(() => props.warnings.filter((w) => w.code === 'TOOL_NEEDS_CONFIGURATION'))
const toolMissingWarnings = computed(() => props.warnings.filter((w) => w.code === 'TOOL_PLUGIN_MISSING'))
const otherWarnings = computed(() => props.warnings.filter(
  (w) => !['PLUGIN_MISSING', 'TOOL_NEEDS_CONFIGURATION', 'TOOL_PLUGIN_MISSING'].includes(w.code),
))

const hasAny = computed(() => props.warnings.length > 0)

function close(): void {
  emit('update:modelValue', false)
}

function confirm(): void {
  emit('confirm')
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    :title="hasAny ? `Warnings before importing '${templateName}'` : `Import '${templateName}'?`"
    size="md"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div v-if="!hasAny" class="text-sm text-muted-foreground">
      No warnings — this template is ready to import.
    </div>

    <div v-else class="flex flex-col gap-5">
      <section v-if="pluginWarnings.length > 0">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
          <Icon name="alert-triangle" class="h-4 w-4 text-amber-500" />
          Missing plugins ({{ pluginWarnings.length }})
        </h3>
        <p class="text-xs text-muted-foreground mb-2">
          These plugins are not installed. Tools they provide will be skipped.
          Plugins are <strong>never</strong> auto-installed — visit the Plugins page to install them manually.
        </p>
        <ul class="space-y-1 text-sm">
          <li
            v-for="w in pluginWarnings"
            :key="w.message"
            class="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2"
          >
            <Icon name="package" class="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <span>{{ w.message }}</span>
          </li>
        </ul>
      </section>

      <section v-if="toolConfigWarnings.length > 0">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
          <Icon name="alert-triangle" class="h-4 w-4 text-amber-500" />
          Tools requiring configuration ({{ toolConfigWarnings.length }})
        </h3>
        <p class="text-xs text-muted-foreground mb-2">
          These tools will be enabled but won't function until API keys are configured in
          <strong>Settings → Tools</strong>.
        </p>
        <ul class="space-y-1 text-sm">
          <li
            v-for="w in toolConfigWarnings"
            :key="w.message"
            class="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2"
          >
            <Icon name="settings" class="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <span>{{ w.message }}</span>
          </li>
        </ul>
      </section>

      <section v-if="toolMissingWarnings.length > 0">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
          <Icon name="alert-triangle" class="h-4 w-4 text-amber-500" />
          Unregistered tools ({{ toolMissingWarnings.length }})
        </h3>
        <p class="text-xs text-muted-foreground mb-2">
          These tools are not currently registered. They will be silently skipped.
        </p>
        <ul class="space-y-1 text-sm">
          <li
            v-for="w in toolMissingWarnings"
            :key="w.message"
            class="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2"
          >
            <Icon name="alert-triangle" class="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <span>{{ w.message }}</span>
          </li>
        </ul>
      </section>

      <section v-if="otherWarnings.length > 0">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Other notes ({{ otherWarnings.length }})
        </h3>
        <ul class="space-y-1 text-sm">
          <li
            v-for="w in otherWarnings"
            :key="w.message"
            class="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2"
          >
            <span>{{ w.message }}</span>
          </li>
        </ul>
      </section>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          @click="close"
          :disabled="submitting"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          @click="confirm"
          :disabled="submitting"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {{ submitting ? 'Importing…' : hasAny ? 'Import anyway' : 'Import' }}
        </button>
      </div>
    </template>
  </Modal>
</template>