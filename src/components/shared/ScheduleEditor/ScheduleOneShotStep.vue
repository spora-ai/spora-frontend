<script setup lang="ts">
/**
 * ScheduleOneShotStep — Step 3 (one-shot branch). Date + time + timezone inputs.
 *
 * Timezone defaults to the browser's IANA tz via `defaultTimezone()` in the
 * parent form; user can override. The tz is sent as `timezone` in the payload;
 * `buildOneShotRunAt` bakes it into the offset suffix of `run_at`.
 */
import { computed, inject } from 'vue'
import { SCHEDULE_FORM_KEY } from '@/composables/scheduleFormKey'
import { buildTimezoneList } from '@/composables/useTimezoneList'
import ScheduleTimezonePicker from './ScheduleTimezonePicker.vue'

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
const timezones = computed(() =>
  buildTimezoneList(form.allTimezones, form.commonZoneValues),
)
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
    <ScheduleTimezonePicker
      id="schedule-timezone"
      v-model="form.timezone.value"
      :timezones="timezones"
    />
  </div>
</template>