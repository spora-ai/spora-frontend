<script setup lang="ts">
/**
 * `AskUserQuestionCard` — multi-question picker for the
 * `ask_user_question` core tool.
 *
 * Visual language matches `ToolApprovalBar`: amber wash, full-width
 * option buttons, emerald submit — so the two interrupt bars feel
 * like one component family in the chat header.
 *
 * Submission is atomic — one `POST /tasks/{id}/answer` covers every
 * question in the batch. The picker disables Submit until every
 * question has at least one selection; a free-text fallback is
 * optional even when enabled.
 */
import { computed, ref, watch } from 'vue'
import { useTaskStore } from '@/stores/tasks'
import type {
  PendingQuestion,
  PendingQuestionBatch,
  PendingQuestionOption,
  AnswerTaskPayload,
} from '@/types/task'
import { ApiError } from '@/api/client'
import { useToast } from '@/composables/useToast'
import Icon from '@/components/ui/Icon.vue'

interface Props {
  /** The first outstanding question batch on the active task. */
  batch: PendingQuestionBatch
}

const props = defineProps<Props>()

const taskStore = useTaskStore()
const toast = useToast()

const activeIndex = ref(0)
const submitting = ref(false)

interface PerQuestionState {
  selectedLabels: string[]
  freeText: string
  freeTextOpen: boolean
}

function makePerQuestionState(): PerQuestionState {
  return {
    selectedLabels: [],
    freeText: '',
    freeTextOpen: false,
  }
}

const perQuestionState = ref<PerQuestionState[]>(
  props.batch.questions.map(() => makePerQuestionState()),
)

watch(
  () => props.batch.questions.map((q) => q.header).join('|'),
  () => {
    activeIndex.value = 0
    perQuestionState.value = props.batch.questions.map(() => makePerQuestionState())
  },
  { immediate: true },
)

const currentQuestion = computed<PendingQuestion>(
  () => props.batch.questions[activeIndex.value] ?? props.batch.questions[0]!,
)

const currentState = computed<PerQuestionState>(
  () => perQuestionState.value[activeIndex.value] ?? perQuestionState.value[0]!,
)

const isLastQuestion = computed<boolean>(
  () => activeIndex.value === props.batch.questions.length - 1,
)

const isFirstQuestion = computed<boolean>(() => activeIndex.value === 0)

const allAnswered = computed<boolean>(() =>
  perQuestionState.value.every((state) => state.selectedLabels.length > 0),
)

function isSelected(option: PendingQuestionOption): boolean {
  return currentState.value.selectedLabels.includes(option.label)
}

function toggleSelection(option: PendingQuestionOption): void {
  const current = currentState.value
  const next = new Set(current.selectedLabels)
  if (next.has(option.label)) {
    next.delete(option.label)
  } else if (currentQuestion.value.multiple) {
    next.add(option.label)
  } else {
    next.clear()
    next.add(option.label)
  }
  current.selectedLabels = Array.from(next)
}

function setActive(index: number): void {
  if (index < 0 || index >= props.batch.questions.length) return
  activeIndex.value = index
}

function goNext(): void {
  if (isLastQuestion.value) return
  setActive(activeIndex.value + 1)
}

function goPrev(): void {
  if (isFirstQuestion.value) return
  setActive(activeIndex.value - 1)
}

function isQuestionAnswered(questionIndex: number): boolean {
  return perQuestionState.value[questionIndex]?.selectedLabels.length > 0
}

function buildPayload(): AnswerTaskPayload {
  return {
    tool_call_id: props.batch.tool_call_id,
    answers: props.batch.questions.map((question, index) => {
      const state = perQuestionState.value[index] ?? makePerQuestionState()
      return {
        header: question.header,
        selections: [...state.selectedLabels],
        free_text: question.allowFreeText && state.freeText.trim().length > 0
          ? state.freeText.trim()
          : null,
      }
    }),
  }
}

async function submit(): Promise<void> {
  if (submitting.value) return
  if (!allAnswered.value) return
  submitting.value = true
  try {
    await taskStore.answerPendingQuestions(buildPayload())
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : 'Failed to submit answers.'
    toast.error(msg)
  } finally {
    submitting.value = false
  }
}

defineExpose({ submit })
</script>

<template>
  <div
    class="border-t border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 shrink-0 sticky top-0 z-10"
    data-testid="ask-user-question-card"
  >
    <div class="max-w-2xl w-full mx-auto px-4 py-4 flex flex-col gap-4">
      <div class="rounded-lg border border-amber-300 dark:border-amber-700 bg-background overflow-hidden">
        <div class="px-3 py-2 flex items-center gap-2 border-b border-amber-200 dark:border-amber-800 bg-amber-100/60 dark:bg-amber-900/30">
          <Icon
            name="info"
            class="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0"
          />
          <span class="text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-200">
            Question
          </span>
          <span class="text-xs text-amber-800/60 dark:text-amber-200/60">·</span>
          <div class="flex items-center gap-1 ml-1 flex-1 min-w-0 overflow-x-auto">
            <button
              v-for="(question, index) in batch.questions"
              :key="question.header"
              type="button"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shrink-0 transition-colors focus-visible:ring-2 focus-visible:ring-amber-400/40 focus-visible:outline-none"
              :class="index === activeIndex
                ? 'bg-amber-600 text-white'
                : isQuestionAnswered(index)
                  ? 'bg-amber-200/60 dark:bg-amber-800/60 text-amber-900 dark:text-amber-100 hover:bg-amber-200 dark:hover:bg-amber-800'
                  : 'bg-white/60 dark:bg-zinc-900/60 text-amber-800/70 dark:text-amber-200/70 hover:bg-white dark:hover:bg-zinc-900'"
              :data-testid="`ask-tab-${index}`"
              :data-active="index === activeIndex ? 'true' : 'false'"
              @click="setActive(index)"
            >
              <Icon
                v-if="isQuestionAnswered(index)"
                name="check"
                class="h-3 w-3"
              />
              {{ question.header }}
            </button>
          </div>
          <span
            class="text-[11px] text-amber-800/70 dark:text-amber-200/70 tabular-nums shrink-0"
            data-testid="ask-progress"
          >
            {{ activeIndex + 1 }} of {{ batch.questions.length }}
          </span>
        </div>

        <div class="p-4 space-y-3">
          <div>
            <p class="text-sm font-medium text-foreground">
              {{ currentQuestion.question }}
            </p>
          </div>

          <div class="flex flex-col gap-2">
            <button
              v-for="(option, optionIndex) in currentQuestion.options"
              :key="option.label"
              type="button"
              class="w-full flex items-start gap-2 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors text-left focus-visible:ring-2 focus-visible:ring-amber-400/40 focus-visible:outline-none"
              :class="isSelected(option)
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                : 'border-border bg-white dark:bg-zinc-900 hover:bg-muted/40'"
              :data-testid="`ask-option-${option.label}`"
              :data-selected="isSelected(option) ? 'true' : 'false'"
              :aria-pressed="isSelected(option)"
              @click="toggleSelection(option)"
            >
              <span
                class="mt-1 h-3 w-3 rounded-full border-2 shrink-0"
                :class="isSelected(option)
                  ? 'border-emerald-500 bg-emerald-500'
                  : 'border-muted-foreground/40'"
                aria-hidden="true"
              />
              <span class="flex-1 min-w-0">
                <span class="flex items-center gap-2">
                  <span class="text-sm font-medium">{{ option.label }}</span>
                  <span
                    v-if="optionIndex === 0 && currentQuestion.options.length > 1"
                    class="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold"
                  >
                    Recommended
                  </span>
                </span>
                <span
                  v-if="option.description"
                  class="block text-xs text-muted-foreground mt-0.5"
                >
                  {{ option.description }}
                </span>
              </span>
            </button>
          </div>

          <details
            v-if="currentQuestion.allowFreeText"
            class="pt-2 border-t border-amber-200/70 dark:border-amber-800/70"
            :open="currentState.freeTextOpen"
            @toggle="currentState.freeTextOpen = ($event.target as HTMLDetailsElement).open"
          >
            <summary class="text-xs text-amber-800/80 dark:text-amber-200/80 cursor-pointer hover:text-amber-900 dark:hover:text-amber-100 select-none list-none">
              Or type your own answer
            </summary>
            <input
              id="ask-free-text-input"
              v-model="currentState.freeText"
              type="text"
              aria-label="Custom answer"
              placeholder="Type a custom answer…"
              class="mt-2 w-full text-sm rounded-md border border-border bg-white dark:bg-zinc-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
              data-testid="ask-free-text"
            >
          </details>
        </div>

        <div class="px-3 py-2.5 border-t border-amber-200 dark:border-amber-800 bg-amber-100/40 dark:bg-amber-900/20 flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-amber-800/80 dark:text-amber-200/80 hover:text-amber-900 dark:hover:text-amber-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            :disabled="isFirstQuestion"
            data-testid="ask-prev"
            @click="goPrev"
          >
            <Icon
              name="chevron-left"
              class="h-3 w-3"
            />
            Prev
          </button>
          <div class="text-[11px] text-amber-800/70 dark:text-amber-200/70 tabular-nums">
            Question {{ activeIndex + 1 }} of {{ batch.questions.length }}
          </div>
          <button
            v-if="!isLastQuestion"
            type="button"
            class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-200/40 dark:hover:bg-amber-800/40 transition-colors"
            data-testid="ask-next"
            @click="goNext"
          >
            Next
            <Icon
              name="chevron-right"
              class="h-3 w-3"
            />
          </button>
          <span class="ml-auto text-[11px] text-amber-800/70 dark:text-amber-200/70">
            <template v-if="!allAnswered">
              Answer all questions to submit.
            </template>
            <template v-else>
              Submit all {{ batch.questions.length }} answers together
            </template>
          </span>
          <button
            type="button"
            class="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium shadow disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            :disabled="!allAnswered || submitting"
            data-testid="ask-submit"
            @click="submit"
          >
            <Icon
              :name="submitting ? 'loader-2' : 'check'"
              :class="['h-3 w-3', submitting ? 'animate-spin' : '']"
            />
            {{ submitting ? 'Submitting…' : 'Submit all answers' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
