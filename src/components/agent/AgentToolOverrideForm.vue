<script setup lang="ts">
/**
 * AgentToolOverrideForm — per-field override inputs for a tool.
 *
 * Owns the local `form` ref (key → value) and the `fieldErrors` map, plus
 * the "Remove all agent overrides" action. The parent supplies the schema
 * (from the tool) and the initial values. Emits the latest form snapshot
 * so the parent can build the submit payload.
 */
import { ref, computed, watch } from 'vue'
import ToolSettingField from '@/components/settings/ToolSettingField.vue'
import type { ToolSchema, SettingsWithSource, ToolSettingSchema } from '@/composables/useToolSettings'
import {
  resolveInitialForm,
  diffAgainst,
  getSource as resolveSource,
  getSourceBadgeClass,
  getSourceLabel,
} from '@/composables/useAgentToolConfig'

const props = defineProps<{
  tool: ToolSchema
  settingsWithSource: SettingsWithSource
  rawOverride: Record<string, string>
  /**
   * Agent's owning principal. Forwarded to <ToolSettingField> so the
   * multi-select picker scopes its `?principal_id=` to the agent's
   * principal — without it the picker falls back to every agent the
   * user can see, allowing cross-principal ids into the override.
   */
  principalId?: number | null
}>()

const emit = defineEmits<{
  'update:form': [form: Record<string, string>]
  'remove-all': []
}>()

const form = ref<Record<string, string>>(resolveInitialForm(props.settingsWithSource))
const fieldErrors = ref<Record<string, string>>({})

/**
 * Settings rendered in the agent override modal. Per-agent overrides
 * see every scope (`any`, `principal`, `agent`) — the modal is the
 * narrowest context in the cascade and the only one that can host a
 * `scope: 'agent'` setting.
 */
const visibleFields = computed<ToolSettingSchema[]>(() => props.tool.settings_schema)

const agentOverridesExist = computed(() => diffAgainst(props.rawOverride).agentOverridesExist)

function getSource(key: string): string {
  return resolveSource(props.settingsWithSource, key)
}

// `immediate: true` makes the watch fire on mount with the current value so
// the parent's `form` ref is populated with the child's initial state. Without
// this, the parent stays at its `ref({})` initializer until the user mutates a
// field, and a "Save with no changes" wipes the override (because the save
// handler reads the parent ref, not the child).
watch(form, (v) => emit('update:form', v), { deep: true, immediate: true })

function onRemoveAll(): void {
  emit('remove-all')
}
</script>

<template>
  <div class="mb-6">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-medium text-foreground">
        Agent-Level Overrides
      </h3>
      <button
        v-if="agentOverridesExist"
        type="button"
        @click="onRemoveAll"
        class="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
      >
        Remove all agent overrides
      </button>
    </div>

    <p class="text-xs text-muted-foreground mb-4">
      Override settings specifically for this agent. Leave empty to inherit from global/user settings.
    </p>

    <div class="space-y-4">
      <div
        v-for="field in visibleFields"
        :key="field.key"
        class="flex flex-col gap-1.5"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-medium">{{ field.label }}</span>
            <span
              v-if="field.required"
              class="text-destructive text-xs"
            >*</span>
            <span
              v-if="getSource(field.key) !== 'default'"
              class="text-xs px-1.5 py-0.5 rounded"
              :class="getSourceBadgeClass(getSource(field.key))"
            >
              {{ getSourceLabel(getSource(field.key)) }}
            </span>
          </div>
        </div>

        <ToolSettingField
          :model-value="form[field.key] ?? ''"
          :field="field"
          :error="fieldErrors[field.key] ?? null"
          :hide-label="true"
          :principal-id="principalId"
          @update:model-value="form[field.key] = String($event ?? '')"
        />
      </div>
    </div>
  </div>
</template>
