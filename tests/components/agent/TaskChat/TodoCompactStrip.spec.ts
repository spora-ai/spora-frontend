/**
 * TodoCompactStrip — bottom-of-chat one-line todo summary.
 *
 * Same data source as `TodoProgressPanel`; the strip itself carries
 * the `lg:hidden` class so the parent doesn't have to gate visibility
 * itself.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import TodoCompactStrip from '@/components/agent/TaskChat/TodoCompactStrip.vue'
import { useTaskStore } from '@/stores/tasks'
import type { TaskDetail, TodoItem } from '@/types/task'

function makeItem(overrides: Partial<TodoItem>): TodoItem {
  return {
    id: null,
    content: '',
    activeForm: null,
    status: 'pending',
    order: 0,
    ...overrides,
  }
}

const baseTask: TaskDetail = {
  id: 1,
  agent_id: 1,
  status: 'RUNNING',
  user_prompt: 'go',
  final_response: null,
  step_count: 0,
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

describe('TodoCompactStrip', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders nothing when no todos are recorded', () => {
    const store = useTaskStore()
    store.activeTask = { ...baseTask, data: {} }
    const wrapper = mount(TodoCompactStrip)
    expect(wrapper.find('[data-testid="todo-compact-strip"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="todo-compact-done"]').text()).toBe('0')
    expect(wrapper.find('[data-testid="todo-compact-total"]').text()).toBe('0')
  })

  it('renders the counts, active label, and progress bar width', () => {
    const store = useTaskStore()
    store.activeTask = {
      ...baseTask,
      data: {
        todos: {
          version: 1,
          items: [
            makeItem({ content: 'Writing summary', activeForm: 'Writing summary', status: 'in_progress', order: 0 }),
            makeItem({ content: 'Cross-check', activeForm: 'Cross-checking headlines', status: 'pending', order: 1 }),
            makeItem({ content: 'List sub-agents', status: 'completed', order: 2 }),
          ],
          updatedAt: null,
        },
      },
    }

    const wrapper = mount(TodoCompactStrip)
    expect(wrapper.find('[data-testid="todo-compact-done"]').text()).toBe('1')
    expect(wrapper.find('[data-testid="todo-compact-total"]').text()).toBe('3')
    expect(wrapper.find('[data-testid="todo-compact-active"]').text()).toBe('Writing summary')

    const bar = wrapper.find('[data-testid="todo-compact-bar"]')
    expect(bar.attributes('style')).toContain('width: 33%')
  })

  it('carries the lg:hidden class so the parent does not gate visibility', () => {
    const store = useTaskStore()
    store.activeTask = { ...baseTask, data: {} }
    const wrapper = mount(TodoCompactStrip)
    const strip = wrapper.find('[data-testid="todo-compact-strip"]')
    expect(strip.classes()).toContain('lg:hidden')
  })

  it('exposes the strip as a focusable button with an aria-label', () => {
    const store = useTaskStore()
    store.activeTask = { ...baseTask, data: {} }
    const wrapper = mount(TodoCompactStrip)
    const strip = wrapper.find('[data-testid="todo-compact-strip"]')
    expect(strip.attributes('role')).toBe('button')
    expect(strip.attributes('tabindex')).toBe('0')
    expect(strip.attributes('aria-label')).toBe('Open task status')
  })

  it('emits open on click so the parent can mount the popover', async () => {
    const store = useTaskStore()
    store.activeTask = {
      ...baseTask,
      data: {
        todos: {
          version: 1,
          items: [
            makeItem({ content: 'Do thing', status: 'in_progress', order: 0 }),
          ],
          updatedAt: null,
        },
      },
    }
    const wrapper = mount(TodoCompactStrip)
    await wrapper.find('[data-testid="todo-compact-strip"]').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('emits open when Enter is pressed on the focused strip', async () => {
    const store = useTaskStore()
    store.activeTask = { ...baseTask, data: {} }
    const wrapper = mount(TodoCompactStrip)
    await wrapper.find('[data-testid="todo-compact-strip"]').trigger('keydown.enter')
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('emits open when Space is pressed on the focused strip (and suppresses page scroll)', async () => {
    const store = useTaskStore()
    store.activeTask = { ...baseTask, data: {} }
    const wrapper = mount(TodoCompactStrip)
    const strip = wrapper.find('[data-testid="todo-compact-strip"]').element
    // Trigger's returned promise resolves with the wrapper, not the
    // underlying Event, so capture the synthesized KeyboardEvent on
    // the strip directly via a one-shot listener. The component's
    // @keydown.space.prevent calls preventDefault on it, which we then
    // assert on.
    const captured = await new Promise<KeyboardEvent>((resolve) => {
      strip.addEventListener('keydown', (event) => {
        resolve(event)
      }, { once: true })
      void wrapper.find('[data-testid="todo-compact-strip"]').trigger('keydown.space')
    })
    expect(wrapper.emitted('open')).toHaveLength(1)
    expect(captured.defaultPrevented).toBe(true)
  })
})
