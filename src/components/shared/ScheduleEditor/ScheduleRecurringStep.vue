<script setup lang="ts">
/**
 * ScheduleRecurringStep — Step 3 (recurring branch). Frequency picker +
 * per-frequency cron panel + live next-3-runs preview.
 */
import { computed, inject } from 'vue'
import CronExpression from 'cron-parser'
import { SCHEDULE_FORM_KEY } from '@/composables/scheduleFormKey'
import { SCHEDULE_FREQUENCY_OPTIONS } from '@/composables/useScheduleWizard'
import { DAY_OF_WEEK_OPTIONS } from '@/utils/cron'
import { buildTimezoneList } from '@/composables/useTimezoneList'

const form = inject(SCHEDULE_FORM_KEY)
if (!form) throw new Error('ScheduleRecurringStep must be used inside <ScheduleEditor>')

const frequencyOptions = SCHEDULE_FREQUENCY_OPTIONS
const dayOfWeekOptions = DAY_OF_WEEK_OPTIONS
const timezones = computed(() => buildTimezoneList(form.allTimezones, form.commonZoneValues))

// v-model proxies for the nested form refs
const frequencyModel = computed({
  get: () => form.frequency.value,
  set: (v) => { form.frequency.value = v as typeof form.frequency.value },
})
const cronExpressionModel = computed({
  get: () => form.cronExpression.value,
  set: (v) => { form.cronExpression.value = v ?? '' },
})
const timezoneModel = computed({
  get: () => form.timezone.value,
  set: (v) => { form.timezone.value = v ?? '' },
})
function makeNumericModel(get: () => number, set: (_v: number) => void) { // eslint-disable-line no-unused-vars
  return computed({
    get: () => get(),
    set: (v) => { set(typeof v === 'number' ? v : Number(v)) },
  })
}
const hourlyIntervalModel = makeNumericModel(
  () => form.hourly.value.interval,
  (v) => { form.hourly.value = { ...form.hourly.value, interval: v } },
)
const hourlyStartHourModel = makeNumericModel(
  () => form.hourly.value.startHour,
  (v) => { form.hourly.value = { ...form.hourly.value, startHour: v } },
)
const hourlyEndHourModel = makeNumericModel(
  () => form.hourly.value.endHour,
  (v) => { form.hourly.value = { ...form.hourly.value, endHour: v } },
)
const hourlyMinuteModel = makeNumericModel(
  () => form.hourly.value.minute,
  (v) => { form.hourly.value = { ...form.hourly.value, minute: v } },
)
const dailyIntervalModel = makeNumericModel(
  () => form.daily.value.interval,
  (v) => { form.daily.value = { ...form.daily.value, interval: v } },
)
const dailyTimeModel = computed({
  get: () => form.daily.value.time,
  set: (v) => { form.daily.value = { ...form.daily.value, time: v ?? '' } },
})
const weeklyDayModel = makeNumericModel(
  () => form.weekly.value.day,
  (v) => { form.weekly.value = { ...form.weekly.value, day: v } },
)
const weeklyTimeModel = computed({
  get: () => form.weekly.value.time,
  set: (v) => { form.weekly.value = { ...form.weekly.value, time: v ?? '' } },
})
const monthlyDayModel = makeNumericModel(
  () => form.monthly.value.day,
  (v) => { form.monthly.value = { ...form.monthly.value, day: v } },
)
const monthlyTimeModel = computed({
  get: () => form.monthly.value.time,
  set: (v) => { form.monthly.value = { ...form.monthly.value, time: v ?? '' } },
})

const previewRuns = computed((): string[] => {
  const cron = form.computedCron.value
  if (!cron) return []
  try {
    const interval = CronExpression.parse(cron, { tz: form.timezone.value })
    const intervals: string[] = []
    for (let i = 0; i < 3; i++) {
      const nextDate = interval.next().toDate()
      intervals.push(nextDate.toLocaleString('en-US', {
        timeZone: form.timezone.value,
        dateStyle: 'medium',
        timeStyle: 'short',
      }))
    }
    return intervals
  } catch {
    return []
  }
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-sm text-muted-foreground">
      Configure how often this schedule should repeat.
    </p>

    <div class="flex flex-col gap-1.5">
      <label for="schedule-frequency" class="text-sm font-medium">Frequency</label>
      <select
        id="schedule-frequency"
        v-model="frequencyModel"
        class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option v-for="opt in frequencyOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </div>

    <div
      v-if="form.frequency.value === 'hourly'"
      class="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4"
    >
      <label class="flex items-center gap-2 flex-wrap">
        <span class="text-sm text-muted-foreground">Every</span>
        <input
          id="schedule-hourly-interval"
          v-model.number="hourlyIntervalModel"
          type="number" min="1" max="23"
          class="w-16 rounded-lg border border-border bg-background px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span class="text-sm text-muted-foreground">hour(s)</span>
      </label>
      <label class="flex items-center gap-2 flex-wrap">
        <span class="text-sm text-muted-foreground">Starting at hour</span>
        <input
          id="schedule-hourly-start"
          v-model.number="hourlyStartHourModel"
          type="number" min="0" max="23"
          class="w-16 rounded-lg border border-border bg-background px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span class="text-sm text-muted-foreground">through</span>
        <input
          id="schedule-hourly-end"
          v-model.number="hourlyEndHourModel"
          type="number" min="0" max="23"
          class="w-16 rounded-lg border border-border bg-background px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span class="text-sm text-muted-foreground">at minute</span>
        <input
          id="schedule-hourly-minute"
          v-model.number="hourlyMinuteModel"
          type="number" min="0" max="59"
          class="w-16 rounded-lg border border-border bg-background px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </label>
      <p class="text-xs text-muted-foreground font-mono">→ {{ form.computedCron || '—' }}</p>
    </div>

    <div
      v-if="form.frequency.value === 'daily'"
      class="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4"
    >
      <label class="flex items-center gap-2 flex-wrap">
        <span class="text-sm text-muted-foreground">Every</span>
        <input
          id="schedule-daily-interval"
          v-model.number="dailyIntervalModel"
          type="number" min="1" max="31"
          class="w-16 rounded-lg border border-border bg-background px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span class="text-sm text-muted-foreground">day(s) at</span>
        <input
          id="schedule-daily-time"
          v-model="dailyTimeModel"
          type="time"
          class="w-28 rounded-lg border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </label>
      <p class="text-xs text-muted-foreground font-mono">→ {{ form.computedCron || '—' }}</p>
    </div>

    <div
      v-if="form.frequency.value === 'weekly'"
      class="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4"
    >
      <label class="flex items-center gap-2 flex-wrap">
        <span class="text-sm text-muted-foreground">Every</span>
        <select
          id="schedule-weekly-day"
          v-model.number="weeklyDayModel"
          class="w-36 rounded-lg border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option v-for="opt in dayOfWeekOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
        <span class="text-sm text-muted-foreground">at</span>
        <input
          id="schedule-weekly-time"
          v-model="weeklyTimeModel"
          type="time"
          class="w-28 rounded-lg border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </label>
      <p class="text-xs text-muted-foreground font-mono">→ {{ form.computedCron || '—' }}</p>
    </div>

    <div
      v-if="form.frequency.value === 'monthly'"
      class="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4"
    >
      <label class="flex items-center gap-2 flex-wrap">
        <span class="text-sm text-muted-foreground">Every</span>
        <input
          id="schedule-monthly-day"
          v-model.number="monthlyDayModel"
          type="number" min="1" max="31"
          class="w-16 rounded-lg border border-border bg-background px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span class="text-sm text-muted-foreground">day of the month at</span>
        <input
          id="schedule-monthly-time"
          v-model="monthlyTimeModel"
          type="time"
          class="w-28 rounded-lg border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </label>
      <p class="text-xs text-muted-foreground font-mono">→ {{ form.computedCron || '—' }}</p>
    </div>

    <div v-if="form.frequency.value === 'custom'" class="flex flex-col gap-1.5">
      <label for="schedule-cron" class="text-sm font-medium">Cron expression</label>
      <input
        id="schedule-cron"
        v-model="cronExpressionModel"
        type="text"
        placeholder="*/15 * * * *"
        class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
      />
      <p class="text-xs text-muted-foreground">
        Format: <span class="font-mono text-[10px]">minute hour day month weekday</span>
      </p>
    </div>

    <div v-if="previewRuns.length > 0" class="rounded-lg border border-border bg-muted/30 px-4 py-3">
      <p class="text-xs font-medium text-muted-foreground mb-2">Next 3 runs</p>
      <ul class="flex flex-col gap-1">
        <li v-for="(run, i) in previewRuns" :key="i" class="text-sm font-mono text-foreground">{{ run }}</li>
      </ul>
    </div>
    <p v-else-if="form.computedCron" class="text-xs text-muted-foreground">
      Could not parse cron expression. Check the syntax.
    </p>

    <div class="flex flex-col gap-1.5">
      <label for="schedule-timezone" class="text-sm font-medium">Timezone</label>
      <select
        id="schedule-timezone"
        v-model="timezoneModel"
        class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option v-for="tz in timezones" :key="tz.value" :value="tz.value">{{ tz.label }}</option>
      </select>
    </div>
  </div>
</template>