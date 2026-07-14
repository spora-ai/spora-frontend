/**
 * scheduleFormKey — typed Vue provide/inject token for the shared
 * `ScheduleForm` reactive state. The shell creates the form once via
 * `useScheduleForm()` and `provide`s it under this key; each step
 * sub-component `inject`s it instead of receiving it as a prop.
 */
import type { InjectionKey } from 'vue'
import type { ScheduleForm } from './useScheduleForm'

export const SCHEDULE_FORM_KEY: InjectionKey<ScheduleForm> = Symbol('scheduleForm')