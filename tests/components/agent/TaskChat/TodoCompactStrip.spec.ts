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
})
