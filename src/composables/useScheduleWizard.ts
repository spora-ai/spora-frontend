/**
 * useScheduleWizard — constants and tiny helpers shared by the 3-step
 * schedule wizard SFC. Domain helpers (cron stringification, payload
 * building, form state, timezone partitioning) live in the three
 * sibling composables:
 *   - @/composables/useSchedulePayload
 *   - @/composables/useScheduleFormState
 *   - @/composables/useTimezoneList
 */
import { i18n } from '@/i18n'
import type { Frequency } from '@/utils/cron'

export const SCHEDULE_TOTAL_STEPS = 3

/**
 * The wizard's three step labels.
 *
 * A function rather than a constant: the labels are catalogue keys, so they
 * have to be resolved against the locale that is active when they are
 * rendered. A constant would freeze the language of whichever locale happened
 * to be active at import time.
 */
export function scheduleStepLabels(): string[] {
  return [
    i18n.global.t('Template'),
    i18n.global.t('Schedule Type'),
    i18n.global.t('Schedule'),
  ]
}

/** The frequencies the recurring step offers, with their labels. */
export function scheduleFrequencyOptions(): { value: Frequency; label: string }[] {
  return [
    { value: 'hourly', label: i18n.global.t('Hourly') },
    { value: 'daily', label: i18n.global.t('Daily') },
    { value: 'weekly', label: i18n.global.t('Weekly') },
    { value: 'monthly', label: i18n.global.t('Monthly') },
    { value: 'custom', label: i18n.global.t('Custom cron') },
  ]
}

/**
 * Pre-defined prompt variables available in scheduled-run prompt templates.
 *
 * The tokens are identifiers the template engine substitutes — they are not
 * copy and stay in English in every language.
 */
export function schedulePromptVariables(): { token: string; description: string }[] {
  return [
    { token: 'current_date', description: i18n.global.t('ISO date, e.g. 2026-04-15') },
    { token: 'current_time', description: i18n.global.t('ISO time, e.g. 14:30') },
    { token: 'current_datetime', description: i18n.global.t('ISO datetime, e.g. 2026-04-15T14:30') },
    { token: 'agent_name', description: i18n.global.t('Agent display name') },
    { token: 'user_name', description: i18n.global.t('Authenticated user name') },
    { token: 'day_of_week', description: i18n.global.t('Day name, e.g. Wednesday') },
    { token: 'day_of_month', description: i18n.global.t('Day of month, e.g. 15') },
    { token: 'month', description: i18n.global.t('Month name, e.g. April') },
    { token: 'year', description: i18n.global.t('Full year, e.g. 2026') },
  ]
}

/** Wrap a token in `{{...}}`. */
export function wrapPromptVariable(token: string): string {
  return `{{${token}}}`
}

/** Whether the Step 1 → Step 2 button is enabled. */
export function canProceedFromStep1(
  templateId: number | null,
  newTemplateName: string,
): boolean {
  if (templateId === null) return false
  if (templateId === -1) return newTemplateName.trim() !== ''
  return true
}
