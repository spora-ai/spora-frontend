/**
 * Shared mount helper for ScheduleEditor step specs. Each step component
 * resolves the shared `ScheduleForm` state via `inject(SCHEDULE_FORM_KEY)`,
 * so tests must provide the form under that key (the shell does it in prod
 * via `provide`). This helper wraps `mount` and injects the supplied form.
 */
import { mount, type MountingOptions } from '@vue/test-utils'
import { SCHEDULE_FORM_KEY } from '@/composables/scheduleFormKey'
import type { Component } from 'vue'
import type { ScheduleForm } from '@/composables/useScheduleForm'

export function mountWithForm<T extends Component>(
  component: T,
  form: ScheduleForm,
  options: MountingOptions<T> = {},
) {
  return mount(component, {
    ...options,
    global: {
      ...(options.global ?? {}),
      provide: {
        ...(options.global?.provide as Record<string, unknown> | undefined ?? {}),
        [SCHEDULE_FORM_KEY]: form,
      },
    },
  })
}