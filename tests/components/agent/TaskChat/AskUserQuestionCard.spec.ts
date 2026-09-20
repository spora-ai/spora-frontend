/**
 * AskUserQuestionCard — multi-question picker.
 *
 * Covers tab navigation, recommended badge, free-text fallback,
 * submit gating, and the AnswerTaskPayload shape sent to the store.
 */
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import AskUserQuestionCard from '@/components/agent/TaskChat/AskUserQuestionCard.vue'
import { useTaskStore } from '@/stores/tasks'
import type { PendingQuestionBatch, AnswerTaskPayload, TaskDetail } from '@/types/task'

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}))

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

const baseTask: TaskDetail = {
  id: 7,
  agent_id: 1,
  status: 'AWAITING_INPUT',
  user_prompt: 'go',
  final_response: null,
  step_count: 1,
  max_steps: 10,
  error_code: null,
  error_message: null,
  failure_reason: null,
  history: [],
  tool_calls: [],
  totals: null,
  created_at: '',
  updated_at: '',
  data: null,
}

function makeBatch(overrides: Partial<PendingQuestionBatch> = {}): PendingQuestionBatch {
  return {
    toolCallId: 'tc_1',
    questions: [
      {
        question: 'Which database backend should the new project use?',
        header: 'DB backend',
        options: [
          { label: 'SQLite', description: 'Zero-config, single file', preview: null },
          { label: 'MySQL', description: 'Shared-hosting friendly', preview: 'MySQL details' },
          { label: 'MariaDB', description: 'Drop-in MySQL replacement', preview: null },
        ],
        multiple: false,
        allowFreeText: true,
      },
      {
        question: 'Which auth provider should we wire up?',
        header: 'Auth',
        options: [
          { label: 'None', description: 'Skip auth for now', preview: null },
          { label: 'Local', description: 'Session cookies', preview: null },
          { label: 'OAuth/OIDC', description: 'Delegate to an IdP', preview: null },
        ],
        multiple: false,
        allowFreeText: true,
      },
    ],
    ...overrides,
  }
}

describe('AskUserQuestionCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders one tab per question and shows the first by default', () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { batch: makeBatch() },
    })
    expect(wrapper.find('[data-testid="ask-tab-0"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ask-tab-1"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Which database backend')
    expect(wrapper.text()).not.toContain('Which auth provider')
  })

  it('marks the first option as Recommended when more than one option is available', () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { batch: makeBatch() },
    })
    expect(wrapper.text()).toContain('Recommended')
  })

  it('switches the visible question when a tab is clicked', async () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { batch: makeBatch() },
    })
    await wrapper.find('[data-testid="ask-tab-1"]').trigger('click')
    await nextTick()
    expect(wrapper.text()).toContain('Which auth provider')
    expect(wrapper.text()).not.toContain('Which database backend')
  })

  it('replaces Next with Submit on the last question', async () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { batch: makeBatch() },
    })
    await wrapper.find('[data-testid="ask-tab-1"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="ask-next"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ask-submit"]').exists()).toBe(true)
  })

  it('disables Submit when not every question has a selection', () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { batch: makeBatch() },
    })
    const submit = wrapper.find<HTMLButtonElement>('[data-testid="ask-submit"]')
    expect(submit.element.disabled).toBe(true)
    expect(wrapper.text()).toContain('Answer all questions to submit.')
  })

  it('enables Submit once every question has at least one selection', async () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { batch: makeBatch() },
    })
    await wrapper.find('[data-testid="ask-option-SQLite"]').trigger('click')
    await wrapper.find('[data-testid="ask-tab-1"]').trigger('click')
    await wrapper.find('[data-testid="ask-option-Local"]').trigger('click')
    await nextTick()

    const submit = wrapper.find<HTMLButtonElement>('[data-testid="ask-submit"]')
    expect(submit.element.disabled).toBe(false)
  })

  it('opens the free-text fallback on toggle', async () => {
    const wrapper = mount(AskUserQuestionCard, {
      props: { batch: makeBatch() },
    })
    // The <details> wrapper renders its body either way; happy-dom does
    // not apply the user-agent `[open]` stylesheet. We assert via the
    // `open` attribute on the wrapper element instead.
    const details = wrapper.find('details')
    expect(details.attributes('open')).toBeUndefined()
    await details.find('summary').trigger('click')
    await nextTick()
    expect(wrapper.find('details').attributes('open')).toBeDefined()
  })

  it('submits an AnswerTaskPayload with all answers via the store action', async () => {
    const store = useTaskStore()
    store.activeTask = { ...baseTask }
    const answerSpy = vi.fn().mockResolvedValue(undefined)
    store.answerPendingQuestions = answerSpy

    const wrapper = mount(AskUserQuestionCard, {
      props: { batch: makeBatch() },
    })

    await wrapper.find('[data-testid="ask-option-SQLite"]').trigger('click')
    await wrapper.find('[data-testid="ask-tab-1"]').trigger('click')
    await wrapper.find('[data-testid="ask-option-Local"]').trigger('click')
    await nextTick()

    await wrapper.find('[data-testid="ask-submit"]').trigger('click')
    await flushPromises()

    expect(answerSpy).toHaveBeenCalledTimes(1)
    const payload = answerSpy.mock.calls[0]?.[0] as AnswerTaskPayload
    expect(payload.toolCallId).toBe('tc_1')
    expect(payload.answers).toEqual([
      { header: 'DB backend', selections: ['SQLite'], freeText: null },
      { header: 'Auth', selections: ['Local'], freeText: null },
    ])
  })

  it('includes free text when the user types into the free-text fallback', async () => {
    const store = useTaskStore()
    store.activeTask = { ...baseTask }
    const answerSpy = vi.fn().mockResolvedValue(undefined)
    store.answerPendingQuestions = answerSpy

    const wrapper = mount(AskUserQuestionCard, {
      props: { batch: makeBatch() },
    })

    await wrapper.find('[data-testid="ask-option-SQLite"]').trigger('click')
    await wrapper.find('summary').trigger('click')
    await nextTick()
    const input = wrapper.find('[data-testid="ask-free-text"]')
    await input.setValue('SQLite 16')

    await wrapper.find('[data-testid="ask-tab-1"]').trigger('click')
    await wrapper.find('[data-testid="ask-option-Local"]').trigger('click')
    await wrapper.find('[data-testid="ask-submit"]').trigger('click')
    await flushPromises()

    const payload = answerSpy.mock.calls[0]?.[0] as AnswerTaskPayload
    expect(payload.answers[0]?.freeText).toBe('SQLite 16')
    expect(payload.answers[1]?.freeText).toBeNull()
  })
})
