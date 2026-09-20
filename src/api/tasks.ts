import { api } from './client'
import type { AnswerTaskPayload } from '@/types/task'

/**
 * `POST /tasks/{id}/answer` — submits a batched answer to a pending
 * `ask_user_question` batch. The backend treats the whole payload
 * atomically: every question in the batch must be answered exactly
 * once, and free-text is rejected when the question's `allowFreeText`
 * is false. The endpoint returns `204 No Content` on success.
 *
 * `api.post` unwraps the standard `{ data: ... }` envelope but a 204
 * body is empty so the call resolves with `undefined`. We discard the
 * return value rather than asserting it, keeping the call site
 * uniform with the other POST actions on the task store.
 */
export const tasksApi = {
  answerTask(taskId: number, payload: AnswerTaskPayload): Promise<void> {
    return api.post(`/tasks/${taskId}/answer`, payload)
  },
}
