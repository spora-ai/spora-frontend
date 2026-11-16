<script setup lang="ts">
/**
 * ScheduleEffortOverride — the reasoning-effort level this run carries.
 *
 * `null` means the run inherits: the template's effort, then the agent's
 * default, then the configuration's. It sits on step 3 — the step that
 * owns the run's own settings — beside where the max-steps override
 * belongs.
 */
import { computed, inject, onMounted, watch } from 'vue'
import { SCHEDULE_FORM_KEY } from '@/composables/scheduleFormKey'
import { useAgentEffort } from '@/composables/useAgentEffort'
import EffortSelect from '@/components/EffortSelect.vue'
import type { EffortSelection } from '@/types/effort'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const form = inject(SCHEDULE_FORM_KEY)
if (!form) throw new Error('ScheduleEffortOverride must be used inside <ScheduleEditor>')

const { supported, levels, load, reconcileInherited } = useAgentEffort()

onMounted(async () => {
  const id = form.agentId.value
  if (id === null) return
  await load(id)
})

// A level the configuration stopped offering cannot be sent, so the run
// falls back to inheriting.
watch(levels, () => {
  form.effortOverride.value = reconcileInherited(form.effortOverride.value)
})

const modelValue = computed(() => form.effortOverride.value ?? '')

const onChange = (value: EffortSelection): void => {
  form.effortOverride.value = value === '' ? null : value
}
</script>

<template>
  <div
    v-if="supported"
    class="flex flex-col gap-1.5"
  >
    <span class="text-sm font-medium">{{ t('Effort') }}</span>
    <EffortSelect
      :levels="levels"
      :model-value="modelValue"
      :empty-choice="t('Use the template default')"
      @update:model-value="onChange"
    />
  </div>
</template>
