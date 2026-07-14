<script setup lang="ts">
/**
 * ScheduleOneShotStep — Step 3 (one-shot branch). Date + time inputs.
 */
import { computed, inject } from 'vue'
import { SCHEDULE_FORM_KEY } from '@/composables/scheduleFormKey'

const form = inject(SCHEDULE_FORM_KEY)
if (!form) throw new Error('ScheduleOneShotStep must be used inside <ScheduleEditor>')

const runDateModel = computed({
  get: () => form.runDate.value,
  set: (v) => { form.runDate.value = v ?? '' },
})
const runTimeModel = computed({
  get: () => form.runTime.value,
  set: (v) => { form.runTime.value = v ?? '' },
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-sm text-muted-foreground">
      Set the date and time for this one-time run.
    </p>
    <div class="flex flex-col gap-1.5">
      <label for="schedule-date" class="text-sm font-medium">Date</label>
      <input
        id="schedule-date"
        v-model="runDateModel"
        type="date"
        class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
    <div class="flex flex-col gap-1.5">
      <label for="schedule-time" class="text-sm font-medium">Time</label>
      <input
        id="schedule-time"
        v-model="runTimeModel"
        type="time"
        class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  </div>
</template>