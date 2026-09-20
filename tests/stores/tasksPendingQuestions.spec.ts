/**
 * Pending questions — the store selector + Mercure merge + answer action.
 *
 * The picker reads `pendingQuestions` from the store; the SSE path
 * pushes fresh batches via `applyTaskUpdate`; the answer action
 * posts the batched payload and refreshes the detail.
 */
import { setActivePinia, createPinia } from 'pinia'
import { useTaskStore } from '@/stores/tasks'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AnswerTaskPayload, PendingQuestionBatch, TaskDetail } from '@/types/task'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(message: string, public readonly code: string = 'UNKNOWN', public readonly status = 0) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

vi.mock('@/api/tasks', () => ({
  tasksApi: {
    answerTask: vi.fn(),
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

const sampleBatch: PendingQuestionBatch = {
  tool_call_id: 'tc_99',
  questions: [
    {
      question: 'Pick a backend',
      header: 'Backend',
      options: [{ label: 'SQLite', description: null, preview: null }],
      multiple: false,
      allowFreeText: false,
    },
  ],
}

async function importMocks() {
  const { tasksApi } = await import('@/api/tasks')
  const { api } = await import('@/api/client')
  return { tasksApi, api }
}

describe('useTaskStore — pending questions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  describe('pendingQuestions selector', () => {
    it('returns null when no batch is outstanding', () => {
      const store = useTaskStore()
      store.activeTask = { ...baseTask, data: {} }
      expect(store.pendingQuestions).toBeNull()
    })

    it('returns the batch list when one or more batches are outstanding', () => {
      const store = useTaskStore()
      store.activeTask = {
        ...baseTask,
        data: { pending_questions: [sampleBatch] },
      }
      expect(store.pendingQuestions).toEqual([sampleBatch])
    })
  })

  describe('SSE merge — applyTaskUpdate', () => {
    it('merges top-level pending_questions into activeTask.data without clobbering siblings', () => {
      const store = useTaskStore()
      store.activeTask = {
        ...baseTask,
        data: { spawned_sub_task_ids: [99], handover: { target_agent_id: 7 } },
      }

      store.applyTaskUpdate(7, { pending_questions: [sampleBatch] })

      expect(store.activeTask?.data).toEqual({
        spawned_sub_task_ids: [99],
        handover: { target_agent_id: 7 },
        pending_questions: [sampleBatch],
      })
    })

    it('clears pending_questions when the backend publishes null', () => {
      const store = useTaskStore()
      store.activeTask = {
        ...baseTask,
        data: { pending_questions: [sampleBatch] },
      }
      store.applyTaskUpdate(7, { pending_questions: null })
      expect(store.activeTask?.data?.pending_questions).toBeNull()
    })

    it('merges data.data (todos + spawned_sub_task_ids) onto activeTask.data without clobbering the pending_questions overlay', () => {
      // `TodoTool` and the handover tool both write into `tasks.data` on
      // the same tick the SSE event publishes. The merge branch must
      // overlay fresh keys (`todos`) while leaving sibling keys
      // (`spawned_sub_task_ids`) intact, and must NOT touch
      // `pending_questions` — that key is owned by the explicit handler
      // below, sourced from the SSE event's top level (tasks.pending_state
      // on the backend).
      const store = useTaskStore()
      store.activeTask = {
        ...baseTask,
        data: { spawned_sub_task_ids: [99], pending_questions: [sampleBatch] },
      }

      store.applyTaskUpdate(7, {
        data: {
          todos: { version: 1, items: [{ id: 't1', content: 'do the thing', activeForm: null, status: 'in_progress', order: 0 }], updatedAt: '2026-09-20T00:00:00Z' },
          spawned_sub_task_ids: [99],
        },
        pending_questions: null,
      })

      expect(store.activeTask?.data?.todos).toEqual({
        version: 1,
        items: [{ id: 't1', content: 'do the thing', activeForm: null, status: 'in_progress', order: 0 }],
        updatedAt: '2026-09-20T00:00:00Z',
      })
      expect(store.activeTask?.data?.spawned_sub_task_ids).toEqual([99])
      // The explicit handler set pending_questions to null on this tick;
      // the new branch did not touch the key.
      expect(store.activeTask?.data?.pending_questions).toBeNull()
    })

    it('strips a stale pending_questions key from data.data so the explicit handler retains authority', () => {
      // Defensive: if a backend ever leaked `pending_questions` into
      // `tasks.data` by mistake, the merge branch must not overwrite
      // the explicit overlay sourced from the SSE event's top level.
      const store = useTaskStore()
      store.activeTask = {
        ...baseTask,
        data: { spawned_sub_task_ids: [42] },
      }

      store.applyTaskUpdate(7, {
        data: { pending_questions: null, todos: { version: 1, items: [], updatedAt: null } },
        pending_questions: [sampleBatch],
      })

      // The explicit handler wins — pending_questions is the SSE
      // top-level [sampleBatch], not the stale data.data.pending_questions
      // null that the merge branch stripped out.
      expect(store.activeTask?.data?.pending_questions).toEqual([sampleBatch])
      expect(store.activeTask?.data?.todos).toEqual({ version: 1, items: [], updatedAt: null })
      expect(store.activeTask?.data?.spawned_sub_task_ids).toEqual([42])
    })
  })

  describe('REST fetch — applyActiveTaskUpdate', () => {
    it('mirrors data.todos and top-level pending_questions from the REST response into activeTask.data', async () => {
      const { api } = await importMocks()
      ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        task: {
          ...baseTask,
          status: 'AWAITING_INPUT',
          data: {
            todos: {
              version: 1,
              items: [{ id: 't1', content: 'do the thing', activeForm: null, status: 'in_progress', order: 0 }],
              updatedAt: '2026-09-20T00:00:00Z',
            },
          },
          pending_questions: [sampleBatch],
        },
      })

      const store = useTaskStore()
      store.activeTask = { ...baseTask }

      await store.fetchTaskDetail(7)

      // `data` (the JSON column) is applied via applyDataField — todos survive.
      expect(store.activeTask?.data?.todos).toEqual({
        version: 1,
        items: [{ id: 't1', content: 'do the thing', activeForm: null, status: 'in_progress', order: 0 }],
        updatedAt: '2026-09-20T00:00:00Z',
      })
      // The mirror overlays top-level `pending_questions` onto `data` so the
      // picker computed picks it up — mirrors the SSE merge's explicit handler
      // so polling-only deployments (no Mercure) refresh the picker.
      expect(store.activeTask?.data?.pending_questions).toEqual([sampleBatch])
      expect(store.pendingTodos?.items).toHaveLength(1)
      expect(store.pendingQuestions).toEqual([sampleBatch])
    })

    it('clears pending_questions when the REST response reports null', async () => {
      const { api } = await importMocks()
      ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        task: {
          ...baseTask,
          status: 'RUNNING',
          data: {},
          pending_questions: null,
        },
      })

      const store = useTaskStore()
      // Pre-existing batch from a prior poll — the new poll must explicitly
      // clear it rather than leave a stale entry in the picker.
      store.activeTask = {
        ...baseTask,
        data: { pending_questions: [sampleBatch] },
      }

      await store.fetchTaskDetail(7)

      expect(store.activeTask?.data?.pending_questions).toBeNull()
      expect(store.pendingQuestions).toBeNull()
    })

    it('leaves pending_questions untouched when the REST response omits the field', async () => {
      const { api } = await importMocks()
      // `pending_questions` intentionally absent — simulates an older task row
      // predating the wire change.
      ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        task: {
          ...baseTask,
          status: 'RUNNING',
          data: { spawned_sub_task_ids: [42] },
        },
      })

      const store = useTaskStore()
      store.activeTask = {
        ...baseTask,
        data: { pending_questions: [sampleBatch] },
      }

      await store.fetchTaskDetail(7)

      // Pre-existing batch must survive a poll that didn't mention the field.
      expect(store.activeTask?.data?.pending_questions).toEqual([sampleBatch])
      expect(store.pendingQuestions).toEqual([sampleBatch])
      // And the freshly-applied JSON column content must also be present
      // (the mirror's overlay sits on top of applyDataField).
      expect(store.activeTask?.data?.spawned_sub_task_ids).toEqual([42])
    })
  })

  describe('REST first-load — fetchTaskDetail with empty activeTask', () => {
    // Page-reload scenario: the user opens a task URL while the task is in
    // AWAITING_INPUT. The store starts with `activeTask = null`, the first
    // /tasks/{id} response must populate the picker on the same render —
    // not after the next 3s polling tick. Without the mirror on the
    // first-load branch, the picker stayed hidden until the second poll
    // when `applyActiveTaskUpdate` retroactively ran the overlay.
    it('mirrors top-level pending_questions into data.pending_questions on first load', async () => {
      const { api } = await importMocks()
      ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        task: {
          ...baseTask,
          status: 'AWAITING_INPUT',
          data: {
            todos: {
              version: 1,
              items: [{ id: 't1', content: 'ship it', activeForm: null, status: 'pending', order: 0 }],
              updatedAt: '2026-09-20T00:00:00Z',
            },
          },
          pending_questions: [sampleBatch],
        },
      })

      const store = useTaskStore()
      // Crucially: activeTask is null — this exercises the first-load branch
      // (the `else` of `activeTask.value?.id === taskId`), not the polling
      // branch that `applyActiveTaskUpdate` already covers.
      store.activeTask = null

      await store.fetchTaskDetail(7)

      // First-load branch ran the mirror — picker computed finds the batch
      // without waiting for the next polling tick.
      expect(store.activeTask?.data?.pending_questions).toEqual([sampleBatch])
      expect(store.pendingQuestions).toEqual([sampleBatch])
      // `data.todos` survives the full-replace (it lives in `incoming.data`).
      expect(store.activeTask?.data?.todos).toEqual({
        version: 1,
        items: [{ id: 't1', content: 'ship it', activeForm: null, status: 'pending', order: 0 }],
        updatedAt: '2026-09-20T00:00:00Z',
      })
      expect(store.pendingTodos?.items).toHaveLength(1)
    })
  })

  describe('answerPendingQuestions', () => {
    it('POSTs the payload via tasksApi and refreshes the task detail', async () => {
      const { tasksApi, api } = await importMocks()
      ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ task: { ...baseTask, status: 'RUNNING' } })
      ;(tasksApi.answerTask as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      const store = useTaskStore()
      store.activeTask = { ...baseTask }
      const payload: AnswerTaskPayload = {
        tool_call_id: 'tc_99',
        answers: [{ header: 'Backend', selections: ['SQLite'], free_text: null }],
      }

      await store.answerPendingQuestions(payload)

      expect(tasksApi.answerTask).toHaveBeenCalledWith(7, payload)
      expect(api.get).toHaveBeenCalledWith('/tasks/7')
    })

    it('throws ApiError when there is no active task', async () => {
      const store = useTaskStore()
      await expect(
        store.answerPendingQuestions({
          tool_call_id: 'tc_99',
          answers: [],
        }),
      ).rejects.toThrow(/No active task/)
    })

    it('serializes the wire payload in snake_case (tool_call_id, free_text)', () => {
      // The backend rejects camelCase field names with a 422 (see
      // `POST /tasks/{id}/answer` validation contract). Pin the wire
      // shape so a regression surfaces here before the request leaves
      // the browser.
      const payload: AnswerTaskPayload = {
        tool_call_id: 'tc_99',
        answers: [{ header: 'Backend', selections: ['SQLite'], free_text: null }],
      }
      expect(Object.keys(payload).sort()).toEqual(['answers', 'tool_call_id'])
      expect(Object.keys(payload.answers[0]!).sort()).toEqual(['free_text', 'header', 'selections'])
      expect(payload).not.toHaveProperty('toolCallId')
      expect(payload.answers[0]).not.toHaveProperty('freeText')
    })
  })
})
