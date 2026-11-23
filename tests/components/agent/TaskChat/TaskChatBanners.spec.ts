/**
 * TaskChatBanners — presentational banner variants.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import TaskChatBanners from '@/components/agent/TaskChat/TaskChatBanners.vue'
import type { TaskDetail } from '@/types/task'

function makeTask(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: 1,
    agent_id: 1,
    status: 'FAILED',
    user_prompt: 'hi',
    final_response: null,
    step_count: 5,
    max_steps: 10,
    error_code: 'RATE_LIMIT',
    error_message: 'slow down',
    failure_reason: null,
    history: [],
    tool_calls: [],
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

const baseProps = {
  task: makeTask(),
  showRetryBanner: false,
  showNonRetryableErrorBanner: false,
  nonRetryableErrorMessage: null,
  showCountdown: false,
  countdown: '',
  retryPolicyNote: null,
  retryAttempt: 2,
  maxRetryAttempts: 4,
  cancelling: false,
}

describe('TaskChatBanners', () => {
  describe('retry banner', () => {
    it('renders when showRetryBanner is true and emits retryNow / dismissBanner', async () => {
      const wrapper = mount(TaskChatBanners, {
        props: { ...baseProps, showRetryBanner: true },
      })
      expect(wrapper.find('[data-testid="retry-banner"]').exists()).toBe(true)
      await wrapper.find('[data-testid="retry-button"]').trigger('click')
      expect(wrapper.emitted('retryNow')).toBeTruthy()
      await wrapper.find('[data-testid="dismiss-retry-banner-button"]').trigger('click')
      expect(wrapper.emitted('dismissBanner')).toBeTruthy()
    })

    it('does not render when showRetryBanner is false', () => {
      const wrapper = mount(TaskChatBanners, {
        props: { ...baseProps },
      })
      expect(wrapper.find('[data-testid="retry-banner"]').exists()).toBe(false)
    })

    it('tells the operator why no automatic retry is coming', () => {
      // The note is the policy state: an agent without a retry policy, or
      // a budget that is spent. Without it the banner says a task failed
      // and nothing about whether it comes back on its own.
      const wrapper = mount(TaskChatBanners, {
        props: {
          ...baseProps,
          showRetryBanner: true,
          retryPolicyNote: 'This task will not be retried automatically.',
        },
      })
      expect(wrapper.text()).toContain('This task will not be retried automatically.')
    })

    it('is the only Retry button when the countdown would show as well', () => {
      // Both surfaces carry a "Retry Now" button, and two of them on
      // screen offer the operator two competing ways to retry the same
      // task.
      const wrapper = mount(TaskChatBanners, {
        props: {
          ...baseProps,
          showRetryBanner: true,
          showCountdown: true,
          countdown: '0:30',
        },
      })
      expect(wrapper.findAll('[data-testid="retry-button"]')).toHaveLength(1)
      expect(wrapper.find('[data-testid="retry-countdown"]').exists()).toBe(false)
    })
  })

  describe('non-retryable banner', () => {
    it('renders when showNonRetryableErrorBanner is true and emits retryNow / dismissBanner', async () => {
      const wrapper = mount(TaskChatBanners, {
        props: {
          ...baseProps,
          task: makeTask({ error_code: 'NO_LLM_CONFIGURATION' }),
          showNonRetryableErrorBanner: true,
          nonRetryableErrorMessage: 'No LLM',
        },
      })
      expect(wrapper.find('[data-testid="non-retryable-error-banner"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('No LLM')
      await wrapper.find('[data-testid="retry-button-non-retryable"]').trigger('click')
      expect(wrapper.emitted('retryNow')).toBeTruthy()
      await wrapper.find('[data-testid="dismiss-non-retryable-banner-button"]').trigger('click')
      expect(wrapper.emitted('dismissBanner')).toBeTruthy()
    })

    it('does not stack the automatic-retry notice on the terminal-error banner', () => {
      // The notice carries a "Retry Now" button too, and the terminal
      // banner carries one of its own.
      const wrapper = mount(TaskChatBanners, {
        props: {
          ...baseProps,
          task: makeTask({ error_code: 'NO_LLM_CONFIGURATION' }),
          showNonRetryableErrorBanner: true,
          nonRetryableErrorMessage: 'No LLM',
          showCountdown: true,
          countdown: '0:30',
        },
      })
      expect(wrapper.find('[data-testid="retry-countdown"]').exists()).toBe(false)
      expect(wrapper.findAll('[data-testid="retry-button-non-retryable"]')).toHaveLength(1)
    })
  })

  describe('countdown', () => {
    it('renders the countdown with the attempt counter and emits cancelRetryChain', async () => {
      const wrapper = mount(TaskChatBanners, {
        props: {
          ...baseProps,
          showCountdown: true,
          countdown: '0:30',
          task: makeTask({ error_code: 'RATE_LIMIT' }),
        },
      })
      expect(wrapper.find('[data-testid="retry-countdown"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="cancel-retry-button"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Retrying in 0:30')
      expect(wrapper.text()).toContain('Attempt 2 of 4')
      await wrapper.find('[data-testid="retry-button"]').trigger('click')
      expect(wrapper.emitted('retryNow')).toBeTruthy()
      await wrapper.find('[data-testid="cancel-retry-button"]').trigger('click')
      expect(wrapper.emitted('cancelRetryChain')).toBeTruthy()
    })

    it('leaves the attempt counter out when the budget is unknown', () => {
      // An agent without a budget never arms a retry, so a countdown
      // without one comes from a core that does not send it — and
      // "Attempt 2 of 1" would be a lie.
      const wrapper = mount(TaskChatBanners, {
        props: {
          ...baseProps,
          showCountdown: true,
          countdown: '0:30',
          maxRetryAttempts: 0,
        },
      })
      expect(wrapper.text()).toContain('Retrying in 0:30')
      expect(wrapper.text()).not.toContain('Attempt')
    })

    it('swaps the message copy when the worker vanished', () => {
      // WORKER_DISCONNECTED is the code the core writes when it reaps a
      // task whose worker stopped. ORPHANED is the name it had before the
      // rename and no code path emits it any more.
      const wrapper = mount(TaskChatBanners, {
        props: {
          ...baseProps,
          showCountdown: true,
          countdown: '0:30',
          task: makeTask({ error_code: 'WORKER_DISCONNECTED' }),
        },
      })
      expect(wrapper.text()).toContain('Task was interrupted')
    })

    it('disables the Cancel button and shows "Cancelling…" when cancelling is true', () => {
      const wrapper = mount(TaskChatBanners, {
        props: { ...baseProps, showCountdown: true, countdown: '0:30', cancelling: true },
      })
      const cancel = wrapper.find('[data-testid="cancel-retry-button"]')
      expect(cancel.attributes('disabled')).toBeDefined()
      expect(cancel.text()).toBe('Cancelling…')
    })
  })
})
