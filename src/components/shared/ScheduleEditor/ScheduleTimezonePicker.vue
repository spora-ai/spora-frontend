<script setup lang="ts">
/**
 * ScheduleTimezonePicker — shared IANA timezone selector for the schedule wizard.
 *
 * Extracted so both `ScheduleOneShotStep` and `ScheduleRecurringStep` render the
 * exact same control: same label, same focus ring, same option ordering. The
 * parent owns the source-of-truth for the tz list (`form.allTimezones` +
 * `form.commonZoneValues`) and passes a pre-computed `timezones` prop down; this
 * component is purely presentational.
 */
import { computed } from 'vue'

interface TimezoneOption { value: string; label: string }

const props = defineProps<{
  modelValue: string
  timezones: TimezoneOption[]
  id?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const valueModel = computed({
  get: () => props.modelValue,
  set: (v) => { emit('update:modelValue', v ?? '') },
})
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="id ?? 'schedule-timezone'" class="text-sm font-medium">Timezone</label>
    <select
      :id="id ?? 'schedule-timezone'"
      v-model="valueModel"
      class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
    >
      <option v-for="tz in timezones" :key="tz.value" :value="tz.value">{{ tz.label }}</option>
    </select>
  </div>
</template>