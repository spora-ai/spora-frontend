<script setup lang="ts">
/**
 * `AskUserQuestionCard` — multi-question picker for the
 * `ask_user_question` core tool.
 *
 * Layout mirrors opencode's `question` tool: tabs at the top navigate
 * between questions, each question gets 2-4 option buttons (the
 * recommended option is marked with a "Recommended" pill), an optional
 * preview pane shows per-option content when focused, and a free-text
 * fallback (collapsed by default, default `allowFreeText=true`) lets
 * the user type their own answer.
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
const focusedOptionIndex = ref<number | null>(null)
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
    focusedOptionIndex.value = null
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

const focusedOption = computed<PendingQuestionOption | null>(() => {
  if (focusedOptionIndex.value === null) return null
  return currentQuestion.value.options[focusedOptionIndex.value] ?? null
})

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
  focusedOptionIndex.value = null
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
    toolCallId: props.batch.toolCallId,
    answers: props.batch.questions.map((question, index) => {
      const state = perQuestionState.value[index] ?? makePerQuestionState()
      return {
        header: question.header,
        selections: [...state.selectedLabels],
        freeText: question.allowFreeText && state.freeText.trim().length > 0
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
    class="border-t-2 border-border bg-muted/40 px-4 py-4"
    data-testid="ask-user-question-card"
  >
    <div class="max-w-3xl mx-auto">
      <div class="rounded-lg border-2 border-primary bg-background overflow-hidden">
        <div class="px-3 py-2 flex items-center gap-2 border-b border-border bg-muted/60">
          <Icon
            name="info"
            class="h-4 w-4 text-muted-foreground shrink-0"
          />
          <span class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Question
          </span>
          <span class="text-xs text-muted-foreground">·</span>
          <div class="flex items-center gap-1 ml-1 flex-1 min-w-0 overflow-x-auto">
            <button
              v-for="(question, index) in batch.questions"
              :key="question.header"
              type="button"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shrink-0 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
              :class="index === activeIndex
                ? 'bg-primary text-primary-foreground'
                : isQuestionAnswered(index)
                  ? 'bg-muted-foreground/20 text-foreground hover:bg-muted-foreground/30'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'"
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
            class="text-[11px] text-muted-foreground tabular-nums shrink-0"
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

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <button
                v-for="(option, optionIndex) in currentQuestion.options"
                :key="option.label"
                type="button"
                class="w-full flex items-start gap-2 px-3 py-2.5 rounded-md border cursor-pointer transition-colors text-left focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
                :class="isSelected(option)
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/40'"
                :data-testid="`ask-option-${option.label}`"
                :data-selected="isSelected(option) ? 'true' : 'false'"
                :aria-pressed="isSelected(option)"
                @click="toggleSelection(option)"
                @mouseenter="focusedOptionIndex = optionIndex"
                @mouseleave="focusedOptionIndex = null"
              >
                <span
                  class="mt-1 h-3 w-3 rounded-full border-2 shrink-0"
                  :class="isSelected(option)
                    ? 'border-primary bg-primary'
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

            <div
              v-if="focusedOption?.preview"
              class="hidden md:block rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap break-all"
              data-testid="ask-option-preview"
            >
              <div class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Preview · {{ focusedOption.label }}
              </div>
              {{ focusedOption.preview }}
            </div>
          </div>

          <details
            v-if="currentQuestion.allowFreeText"
            class="pt-2 border-t border-border"
            :open="currentState.freeTextOpen"
            @toggle="currentState.freeTextOpen = ($event.target as HTMLDetailsElement).open"
          >
            <summary class="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none list-none">
              Or type your own answer
            </summary>
            <input
              v-model="currentState.freeText"
              type="text"
              placeholder="Type a custom answer…"
              class="mt-2 w-full text-sm rounded-md border border-border px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              data-testid="ask-free-text"
            >
          </details>
        </div>

        <div class="px-3 py-2.5 border-t border-border bg-muted/60 flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
          <div class="text-[11px] text-muted-foreground tabular-nums">
            Question {{ activeIndex + 1 }} of {{ batch.questions.length }}
          </div>
          <button
            v-if="!isLastQuestion"
            type="button"
            class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-foreground hover:bg-muted transition-colors"
            data-testid="ask-next"
            @click="goNext"
          >
            Next
            <Icon
              name="chevron-right"
              class="h-3 w-3"
            />
          </button>
          <span class="ml-auto text-[11px] text-muted-foreground">
            <template v-if="!allAnswered">
              Answer all questions to submit.
            </template>
            <template v-else>
              Submit all {{ batch.questions.length }} answers together
            </template>
          </span>
          <button
            type="button"
            class="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
