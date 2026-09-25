<script setup lang="ts">
import { computed, ref } from 'vue'
import hljs from '@/lib/highlight'
import { formatToolArguments, isFlatArguments, parseArguments } from '@/composables/useToolArgumentFormatter'
import { isUrl, isEmail } from '@/composables/useToolArgumentsEditor'
import Icon from '@/components/ui/Icon.vue'

const props = withDefaults(defineProps<{
  arguments: Record<string, unknown> | string | null
  toolName?: string
  operation?: string | null
  expanded?: boolean
  /**
   * Parameter field order from `ToolCall.parameter_schema.properties`,
   * matching the editor's display. Omit to fall back to the formatter's
   * important-first alphabetical default.
   */
  parameterOrder?: string[]
}>(), {
  parameterOrder: () => [],
})

const showSensitive = ref<Record<string, boolean>>({})

// State is intentionally local: collapsing + re-expanding the row keeps
// the toggle on so the operator doesn't lose context across view changes.
const showRaw = ref(false)

const copyState = ref<'idle' | 'copied'>('idle')
let copyResetTimer: number | null = null

async function copyJson(): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(props.arguments, null, 2))
    copyState.value = 'copied'
    if (copyResetTimer !== null) {
      window.clearTimeout(copyResetTimer)
    }
    copyResetTimer = window.setTimeout(() => {
      copyState.value = 'idle'
      copyResetTimer = null
    }, 1500)
  } catch {
    // Clipboard may be blocked (insecure context, permissions). The
    // user can still copy manually from the JSON view.
  }
}

const parsedArgs = computed(() => parseArguments(props.arguments))

const flat = computed(() => isFlatArguments(parsedArgs.value))
const fields = computed(() => formatToolArguments(parsedArgs.value, {
  toolName: props.toolName,
  operation: props.operation,
  parameterOrder: props.parameterOrder,
}))

const highlightedJson = computed(() => {
  try {
    const json = JSON.stringify(parsedArgs.value, null, 2)
    const highlighted = hljs.highlight(json, { language: 'json' }).value
    return highlighted
  } catch {
    return JSON.stringify(parsedArgs.value, null, 2)
  }
})

function toggleSensitive(key: string) {
  showSensitive.value[key] = !showSensitive.value[key]
}

function formatValue(value: unknown, format: string): string {
  if (value === null || value === undefined) return '—'
  if (format === 'sensitive') {
    const str = String(value)
    if (str.length <= 4) return '••••••••'
    return str.slice(0, 2) + '••••••••' + str.slice(-2)
  }
  if (format === 'badge') return String(value).replaceAll('_', ' ')
  if (format === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}
</script>

<template>
  <div
    v-if="flat"
    class="rounded-lg border border-border bg-muted/20 overflow-hidden"
  >
    <details
      :open="expanded ?? false"
    >
      <summary class="flex items-center gap-1.5 px-3 py-2 cursor-pointer select-none list-none text-xs text-muted-foreground hover:bg-muted/30 transition-colors">
        <Icon
          name="chevron-right"
          class="arg-chevron h-3 w-3 shrink-0"
        />
        <span>Arguments ({{ fields.length }})</span>
      </summary>

      <!--
        Body renders only while the panel is open. The toggle lives
        here, not in the summary, so the browser's native <details>
        hiding keeps it out of view when collapsed.
      -->
      <div>
        <div class="flex justify-end px-3 py-1.5 border-t border-border bg-background/40">
          <button
            type="button"
            class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            :aria-pressed="showRaw"
            data-testid="tool-arguments-show-raw"
            @click="showRaw = !showRaw"
          >
            {{ showRaw ? 'Show formatted' : 'Show full input' }}
          </button>
        </div>

        <div
          v-if="showRaw"
          class="relative border-t border-border"
          data-testid="tool-arguments-raw"
        >
          <button
            type="button"
            class="absolute right-2 top-2 text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-2 py-1 rounded bg-muted/50"
            @click="copyJson"
          >
            <svg
              class="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect
                x="9"
                y="9"
                width="13"
                height="13"
                rx="2"
                ry="2"
              />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {{ copyState === 'copied' ? 'Copied' : 'Copy' }}
          </button>
          <pre class="px-3 py-2 text-xs font-mono overflow-x-auto"><code v-html="highlightedJson" /></pre>
        </div>

        <div
          v-else
          class="px-3 py-2 space-y-2"
          data-testid="tool-arguments-formatted"
        >
          <template
            v-for="field in fields"
            :key="field.key"
          >
            <div
              v-if="field.format === 'multiline'"
              class="flex flex-col gap-0.5"
            >
              <span class="text-xs font-medium text-muted-foreground">{{ field.label }}</span>
              <pre class="text-xs font-mono text-foreground whitespace-pre-wrap break-words bg-muted/30 rounded px-2 py-1.5 max-h-40 overflow-y-auto">{{ String(field.value ?? '') }}</pre>
            </div>

            <div
              v-else-if="field.format === 'email'"
              class="flex items-center gap-2"
            >
              <span class="text-xs font-medium text-muted-foreground min-w-[70px]">{{ field.label }}</span>
              <a
                v-if="isEmail(field.value)"
                :href="`mailto:${field.value}`"
                class="text-xs font-mono text-primary hover:underline"
              >
                {{ String(field.value) }}
              </a>
              <span
                v-else
                class="text-xs font-mono text-foreground"
              >{{ String(field.value) }}</span>
            </div>

            <div
              v-else-if="field.format === 'url'"
              class="flex items-center gap-2"
            >
              <span class="text-xs font-medium text-muted-foreground min-w-[70px]">{{ field.label }}</span>
              <a
                v-if="isUrl(field.value)"
                :href="String(field.value)"
                target="_blank"
                rel="noopener"
                class="text-xs font-mono text-primary hover:underline truncate max-w-[750px]"
              >
                {{ String(field.value) }}
              </a>
              <span
                v-else
                class="text-xs font-mono text-foreground truncate max-w-[750px]"
              >{{ String(field.value) }}</span>
            </div>

            <div
              v-else-if="field.format === 'sensitive'"
              class="flex items-center gap-2"
            >
              <span class="text-xs font-medium text-muted-foreground min-w-[70px]">{{ field.label }}</span>
              <span class="text-xs font-mono text-muted-foreground">
                {{ showSensitive[field.key] ? formatValue(field.value, field.format) : '••••••••' }}
              </span>
              <button
                type="button"
                @click="toggleSensitive(field.key)"
                class="text-xs text-muted-foreground hover:text-foreground"
              >
                {{ showSensitive[field.key] ? 'hide' : 'show' }}
              </button>
            </div>

            <div
              v-else-if="field.format === 'badge'"
              class="flex items-center gap-2"
            >
              <span class="text-xs font-medium text-muted-foreground min-w-[70px]">{{ field.label }}</span>
              <span class="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary capitalize">
                {{ formatValue(field.value, field.format) }}
              </span>
            </div>

            <div
              v-else-if="field.format === 'boolean'"
              class="flex items-center gap-2"
            >
              <span class="text-xs font-medium text-muted-foreground min-w-[70px]">{{ field.label }}</span>
              <span
                :class="field.value ? 'text-green-600' : 'text-red-500'"
                class="text-xs font-medium"
              >
                {{ formatValue(field.value, field.format) }}
              </span>
            </div>

            <div
              v-else
              class="flex items-center gap-2"
            >
              <span class="text-xs font-medium text-muted-foreground min-w-[70px]">{{ field.label }}</span>
              <span class="text-xs font-mono text-foreground truncate max-w-[750px]">{{ String(field.value ?? '') }}</span>
            </div>
          </template>
        </div>
      </div>
    </details>
  </div>

  <div
    v-else
    class="rounded-lg border border-border bg-muted/20 overflow-hidden"
  >
    <details
      :open="expanded ?? false"
    >
      <summary class="flex items-center gap-1.5 px-3 py-2 cursor-pointer select-none list-none text-xs text-muted-foreground hover:bg-muted/30 transition-colors">
        <Icon
          name="chevron-right"
          class="arg-chevron h-3 w-3 shrink-0"
        />
        Arguments (complex structure)
      </summary>
      <div class="relative border-t border-border">
        <button
          type="button"
          @click="copyJson"
          class="absolute right-2 top-2 text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-2 py-1 rounded bg-muted/50"
        >
          <svg
            class="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect
              x="9"
              y="9"
              width="13"
              height="13"
              rx="2"
              ry="2"
            />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {{ copyState === 'copied' ? 'Copied' : 'Copy' }}
        </button>
        <pre class="px-3 py-2 text-xs font-mono overflow-x-auto"><code v-html="highlightedJson" /></pre>
      </div>
    </details>
  </div>
</template>

<style scoped>
summary::-webkit-details-marker {
  display: none;
}
summary {
  list-style: none;
}

/* Scoped CSS rather than Tailwind's `group-open:` variant, which was
 * being shadowed by the summary's `display: list-item` default in some
 * builds. */
.arg-chevron {
  transition: transform 220ms ease;
}
details[open] > summary .arg-chevron {
  transform: rotate(90deg);
}
</style>
