/**
 * TodoProgressPanel — right-side `lg+` checklist.
 *
 * Same data source as the compact strip; the panel groups the items
 * by status (in progress / pending / completed) and renders an
 * overall progress bar + a "N done · M open" footer.
 */
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import TodoProgressPanel from '@/components/agent/TaskChat/TodoProgressPanel.vue'
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

describe('TodoProgressPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders nothing when no todos are recorded', () => {
    const store = useTaskStore()
    store.activeTask = { ...baseTask, data: {} }
    const wrapper = mount(TodoProgressPanel)
    expect(wrapper.find('[data-testid="todo-progress-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="todo-progress-group-in-progress"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="todo-progress-group-pending"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="todo-progress-group-completed"]').exists()).toBe(false)
  })

  it('groups items by status and renders the progress bar at the right percent', () => {
    const store = useTaskStore()
    store.activeTask = {
      ...baseTask,
      data: {
        todos: {
          version: 1,
          items: [
            makeItem({ content: 'Writing summary', activeForm: 'Writing summary', status: 'in_progress', order: 0 }),
            makeItem({ content: 'Cross-check', activeForm: 'Cross-checking headlines', status: 'pending', order: 1 }),
            makeItem({ content: 'Format markdown', status: 'pending', order: 2 }),
            makeItem({ content: 'List sub-agents', status: 'completed', order: 3 }),
            makeItem({ content: 'Spawn research', status: 'completed', order: 4 }),
          ],
          updatedAt: null,
        },
      },
    }

    const wrapper = mount(TodoProgressPanel)
    expect(wrapper.find('[data-testid="todo-progress-group-in-progress"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="todo-progress-group-pending"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="todo-progress-group-completed"]').exists()).toBe(true)

    expect(wrapper.text()).toContain('Writing summary')
    expect(wrapper.text()).toContain('Cross-checking headlines')
    expect(wrapper.text()).toContain('Format markdown')

    const footer = wrapper.find('[data-testid="todo-progress-footer"]')
    expect(footer.text()).toContain('2 done')
    expect(footer.text()).toContain('3 open')

    const bar = wrapper.find('[data-testid="todo-progress-bar"]')
    expect(bar.attributes('aria-valuenow')).toBe('40')
  })

  it('recomputes when the store data changes', async () => {
    const store = useTaskStore()
    store.activeTask = {
      ...baseTask,
      data: {
        todos: {
          version: 1,
          items: [
            makeItem({ content: 'Step 1', status: 'completed', order: 0 }),
            makeItem({ content: 'Step 2', status: 'in_progress', order: 1 }),
            makeItem({ content: 'Step 3', status: 'pending', order: 2 }),
          ],
          updatedAt: null,
        },
      },
    }

    const wrapper = mount(TodoProgressPanel)
    expect(wrapper.find('[data-testid="todo-progress-footer"]').text()).toContain('1 done')

    store.activeTask = {
      ...baseTask,
      data: {
        todos: {
          version: 1,
          items: [
            makeItem({ content: 'Step 1', status: 'completed', order: 0 }),
            makeItem({ content: 'Step 2', status: 'completed', order: 1 }),
            makeItem({ content: 'Step 3', status: 'pending', order: 2 }),
          ],
          updatedAt: null,
        },
      },
    }
    await nextTick()
    await flushPromises()
    expect(wrapper.find('[data-testid="todo-progress-footer"]').text()).toContain('2 done')
    expect(wrapper.find('[data-testid="todo-progress-footer"]').text()).toContain('1 open')
  })
})
