import { api } from './client'
import type { AnswerTaskPayload, TaskDetail } from '@/types/task'

/**
 * `POST /tasks/{id}/answer` — submits a batched answer to a pending
 * `ask_user_question` batch. The backend treats the whole payload
 * atomically: every question in the batch must be answered exactly
 * once, and free-text is rejected when the question's `allowFreeText`
 * is false.
 *
 * On success the endpoint returns the updated task resource in the
 * standard `{ data: { task } }` envelope (mirrors approve / reject /
 * abort) so the store can apply the new `status`, `pending_state`
 * (now empty or with the next batch), and appended `task_history`
 * row without a follow-up GET round-trip. See TaskController::answer.
 */
export const tasksApi = {
  answerTask(taskId: number, payload: AnswerTaskPayload): Promise<{ task: TaskDetail }> {
    return api.post(`/tasks/${taskId}/answer`, payload)
  },
}
