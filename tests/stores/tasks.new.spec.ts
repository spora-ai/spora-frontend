import { setActivePinia, createPinia } from 'pinia'
import { useTaskStore } from '@/stores/tasks'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Task } from '@/types/task'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
  },
  ApiError: class ApiError extends Error { constructor(public m: string) { super(m) } },
}))

const baseTask = {
  id: 1,
  agent_id: 1,
  user_prompt: 'Do something',
  final_response: null,
  step_count: 1,
  max_steps: 10,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:01Z',
}

function makeTask(overrides: Partial<Task> & { id: number; agent_id: number; status: Task['status'] }): Task {
  return { ...baseTask, ...overrides } as Task
}

describe('useTaskStore — dashboard computed getters', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('activeStatesByAgent', () => {
    it('returns an empty map when there are no tasks', () => {
      const store = useTaskStore()
      expect(store.activeStatesByAgent.size).toBe(0)
    })

    it('contains only non-terminal states per agent', () => {
      const store = useTaskStore()
      store.tasks = [
        makeTask({ id: 1, agent_id: 1, status: 'RUNNING' }),
        makeTask({ id: 2, agent_id: 1, status: 'COMPLETED' }),
        makeTask({ id: 3, agent_id: 1, status: 'FAILED' }),
        makeTask({ id: 4, agent_id: 1, status: 'CANCELLED' }),
      ]

      const states = store.activeStatesByAgent.get(1)
      expect(states).toBeDefined()
      expect(states!.size).toBe(1)
      expect(states!.has('RUNNING')).toBe(true)
      expect(states!.has('COMPLETED')).toBe(false)
      expect(states!.has('FAILED')).toBe(false)
      expect(states!.has('CANCELLED')).toBe(false)
    })

    it('tracks multiple active states for a single agent (RUNNING + PENDING_APPROVAL)', () => {
      const store = useTaskStore()
      store.tasks = [
        makeTask({ id: 1, agent_id: 1, status: 'RUNNING' }),
        makeTask({ id: 2, agent_id: 1, status: 'PENDING_APPROVAL' }),
      ]

      const states = store.activeStatesByAgent.get(1)
      expect(states).toBeDefined()
      expect(states!.size).toBe(2)
      expect(states!.has('RUNNING')).toBe(true)
      expect(states!.has('PENDING_APPROVAL')).toBe(true)
    })

    it('groups multiple active states per agent independently', () => {
      const store = useTaskStore()
      store.tasks = [
        makeTask({ id: 1, agent_id: 1, status: 'RUNNING' }),
        makeTask({ id: 2, agent_id: 1, status: 'PENDING_APPROVAL' }),
        makeTask({ id: 3, agent_id: 2, status: 'PENDING_APPROVAL' }),
        makeTask({ id: 4, agent_id: 3, status: 'RUNNING' }),
      ]

      const map = store.activeStatesByAgent
      expect(map.size).toBe(3)

      const a1 = map.get(1)!
      expect(a1.size).toBe(2)
      expect(a1.has('RUNNING')).toBe(true)
      expect(a1.has('PENDING_APPROVAL')).toBe(true)

      const a2 = map.get(2)!
      expect(a2.size).toBe(1)
      expect(a2.has('PENDING_APPROVAL')).toBe(true)

      const a3 = map.get(3)!
      expect(a3.size).toBe(1)
      expect(a3.has('RUNNING')).toBe(true)
    })

    it('excludes agents that only have terminal tasks', () => {
      const store = useTaskStore()
      store.tasks = [
        makeTask({ id: 1, agent_id: 1, status: 'RUNNING' }),
        makeTask({ id: 2, agent_id: 2, status: 'COMPLETED' }),
        makeTask({ id: 3, agent_id: 3, status: 'FAILED' }),
        makeTask({ id: 4, agent_id: 4, status: 'CANCELLED' }),
      ]

      const map = store.activeStatesByAgent
      expect(map.size).toBe(1)
      expect(map.has(2)).toBe(false)
      expect(map.has(3)).toBe(false)
      expect(map.has(4)).toBe(false)
      expect(map.get(1)?.has('RUNNING')).toBe(true)
    })

    it('deduplicates the same status appearing across multiple tasks of one agent', () => {
      const store = useTaskStore()
      store.tasks = [
        makeTask({ id: 1, agent_id: 1, status: 'RUNNING' }),
        makeTask({ id: 2, agent_id: 1, status: 'RUNNING' }),
        makeTask({ id: 3, agent_id: 1, status: 'RUNNING' }),
      ]

      const states = store.activeStatesByAgent.get(1)
      expect(states!.size).toBe(1)
      expect(states!.has('RUNNING')).toBe(true)
    })
  })

  describe('kpiCounts', () => {
    it('returns zeros when there are no tasks', () => {
      const store = useTaskStore()
      expect(store.kpiCounts).toEqual({ runningTasks: 0, awaitingTasks: 0 })
    })

    it('counts RUNNING tasks regardless of agent ownership', () => {
      const store = useTaskStore()
      store.tasks = [
        makeTask({ id: 1, agent_id: 1, status: 'RUNNING' }),
        makeTask({ id: 2, agent_id: 2, status: 'RUNNING' }),
        makeTask({ id: 3, agent_id: 3, status: 'RUNNING' }),
        makeTask({ id: 4, agent_id: 1, status: 'COMPLETED' }),
      ]

      expect(store.kpiCounts).toEqual({ runningTasks: 3, awaitingTasks: 0 })
    })

    it('counts PENDING_APPROVAL tasks as awaiting regardless of agent ownership', () => {
      const store = useTaskStore()
      store.tasks = [
        makeTask({ id: 1, agent_id: 1, status: 'PENDING_APPROVAL' }),
        makeTask({ id: 2, agent_id: 2, status: 'PENDING_APPROVAL' }),
        makeTask({ id: 3, agent_id: 1, status: 'RUNNING' }),
      ]

      expect(store.kpiCounts).toEqual({ runningTasks: 1, awaitingTasks: 2 })
    })

    it('ignores terminal statuses (COMPLETED, FAILED, CANCELLED)', () => {
      const store = useTaskStore()
      store.tasks = [
        makeTask({ id: 1, agent_id: 1, status: 'COMPLETED' }),
        makeTask({ id: 2, agent_id: 2, status: 'FAILED' }),
        makeTask({ id: 3, agent_id: 3, status: 'CANCELLED' }),
      ]

      expect(store.kpiCounts).toEqual({ runningTasks: 0, awaitingTasks: 0 })
    })

    it('ignores PENDING status (not a KPI status)', () => {
      const store = useTaskStore()
      store.tasks = [
        makeTask({ id: 1, agent_id: 1, status: 'PENDING' }),
        makeTask({ id: 2, agent_id: 2, status: 'PENDING' }),
      ]

      expect(store.kpiCounts).toEqual({ runningTasks: 0, awaitingTasks: 0 })
    })

    it('handles a mixed fleet correctly', () => {
      const store = useTaskStore()
      store.tasks = [
        makeTask({ id: 1, agent_id: 1, status: 'RUNNING' }),
        makeTask({ id: 2, agent_id: 1, status: 'RUNNING' }),
        makeTask({ id: 3, agent_id: 1, status: 'PENDING_APPROVAL' }),
        makeTask({ id: 4, agent_id: 2, status: 'PENDING_APPROVAL' }),
        makeTask({ id: 5, agent_id: 2, status: 'COMPLETED' }),
        makeTask({ id: 6, agent_id: 3, status: 'FAILED' }),
        makeTask({ id: 7, agent_id: 4, status: 'CANCELLED' }),
        makeTask({ id: 8, agent_id: 5, status: 'PENDING' }),
      ]

      expect(store.kpiCounts).toEqual({ runningTasks: 2, awaitingTasks: 2 })
    })

    it('updates reactively when tasks change', () => {
      const store = useTaskStore()
      store.tasks = [makeTask({ id: 1, agent_id: 1, status: 'RUNNING' })]
      expect(store.kpiCounts).toEqual({ runningTasks: 1, awaitingTasks: 0 })

      // Add an awaiting task
      store.tasks.push(makeTask({ id: 2, agent_id: 2, status: 'PENDING_APPROVAL' }))
      expect(store.kpiCounts).toEqual({ runningTasks: 1, awaitingTasks: 1 })

      // Replace the running task with a terminal one
      store.tasks = [makeTask({ id: 2, agent_id: 2, status: 'PENDING_APPROVAL' })]
      expect(store.kpiCounts).toEqual({ runningTasks: 0, awaitingTasks: 1 })

      // Clear all tasks
      store.tasks = []
      expect(store.kpiCounts).toEqual({ runningTasks: 0, awaitingTasks: 0 })
    })

    it('updates reactively for activeStatesByAgent when tasks change', () => {
      const store = useTaskStore()
      store.tasks = [makeTask({ id: 1, agent_id: 1, status: 'RUNNING' })]
      expect(store.activeStatesByAgent.get(1)?.size).toBe(1)

      // Add PENDING_APPROVAL — agent 1 should now have both states
      store.tasks.push(makeTask({ id: 2, agent_id: 1, status: 'PENDING_APPROVAL' }))
      expect(store.activeStatesByAgent.get(1)?.size).toBe(2)

      // Mark the running task COMPLETED — only PENDING_APPROVAL remains
      store.tasks[0] = makeTask({ id: 1, agent_id: 1, status: 'COMPLETED' })
      const states = store.activeStatesByAgent.get(1)
      expect(states?.size).toBe(1)
      expect(states?.has('PENDING_APPROVAL')).toBe(true)
      expect(states?.has('RUNNING')).toBe(false)
    })
  })
})