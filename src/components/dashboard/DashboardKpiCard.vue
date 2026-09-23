<script setup lang="ts">
/**
 * DashboardKpiCard — one KPI tile used by DashboardKpiStrip.
 *
 * Mirrors the prototype's `.kpi` block: a top-row label (plus optional
 * pulse-light indicator), a large count, and a small description. Selecting
 * a card bubbles a `select` event with the corresponding `kpiKey` so the
 * strip can mutate the dashboard's chip filter. Each accent recolors the
 * top edge and the count number so the eye can scan the strip at a glance.
 *
 * The `aborted` accent uses a static pulse (no animation) — the user has
 * already paused the loop, the system is waiting for their input, and an
 * animated cue would misleadingly imply agent activity.
 *
 * Top-bar color: the prior CSS used `hsl(var(--status-running|awaiting))`
 * — those tokens were never defined, so running/awaiting showed no top
 * bar. Each accent now maps to a concrete Tailwind color directly.
 */

interface Props {
  /** Short label shown in the top row, e.g. 'Running'. */
  label: string
  /** Big numeric value displayed below the label. */
  count: number | string
  /** Visual accent — recolors the top border and the count. */
  accent: 'all' | 'running' | 'awaiting' | 'aborted' | 'scheduled'
  /** Optional pulse-light indicator next to the label. Null hides it. */
  pulseClass?: 'live' | 'you' | 'paused' | 'soon' | null
  /** When true, applies the "selected" ring + background treatment. */
  active?: boolean
  /** Chip filter value to emit on click (parent owns click-as-filter). */
  kpiKey: 'all' | 'RUNNING' | 'AWAITING' | 'ABORTED' | 'SCHEDULED'
  /** Helper text under the count, e.g. 'tasks in flight'. */
  description?: string
}

const props = withDefaults(defineProps<Props>(), {
  pulseClass: null,
  active: false,
  description: '',
})

const emit = defineEmits<{
  /** Fired on click with this card's kpiKey so the parent strip can update chip. */
  select: [kpiKey: Props['kpiKey']]
}>()

interface PulseVisual {
  /** Color class applied to the dot, ring, and label. */
  colorClass: string
  /** Short uppercase tag rendered next to the dot. */
  tag: string
  /** Which pulse animation class the inner dot gets (running/awaiting/static). */
  animClass: 'pulse-light-running' | 'pulse-light-awaiting' | 'pulse-light-static'
}

function pulseVisual(pulse: NonNullable<Props['pulseClass']>): PulseVisual {
  switch (pulse) {
    case 'live':
      return { colorClass: 'text-blue-600 dark:text-blue-400', tag: 'live', animClass: 'pulse-light-running' }
    case 'you':
      return { colorClass: 'text-amber-600 dark:text-amber-400', tag: 'you', animClass: 'pulse-light-awaiting' }
    case 'paused':
      return { colorClass: 'text-stone-500 dark:text-stone-400', tag: 'paused', animClass: 'pulse-light-static' }
    case 'soon':
      return { colorClass: 'text-violet-600 dark:text-violet-400', tag: 'soon', animClass: 'pulse-light-static' }
  }
}

const accentCountClass: Record<Props['accent'], string> = {
  all: 'text-foreground',
  running: 'text-blue-600 dark:text-blue-400',
  awaiting: 'text-amber-600 dark:text-amber-400',
  aborted: 'text-stone-600 dark:text-stone-300',
  scheduled: 'text-violet-600 dark:text-violet-400',
}

const accentLabelClass: Record<Props['accent'], string> = {
  all: 'text-muted-foreground',
  running: 'text-blue-600 dark:text-blue-400',
  awaiting: 'text-amber-600 dark:text-amber-400',
  aborted: 'text-stone-600 dark:text-stone-300',
  scheduled: 'text-violet-600 dark:text-violet-400',
}

const accentTopBarClass: Record<Props['accent'], string> = {
  all: 'bg-muted-foreground',
  running: 'bg-blue-500',
  awaiting: 'bg-amber-500',
  aborted: 'bg-muted-foreground',
  scheduled: 'bg-violet-500',
}

function onClick(): void {
  emit('select', props.kpiKey)
}
</script>

<template>
  <button
    type="button"
    :data-kpi="kpiKey"
    :data-active="active ? 'true' : 'false'"
    :class="['kpi', `kpi-${accent}`, 'group relative w-full cursor-pointer overflow-hidden rounded-[var(--radius)] border border-border bg-background px-5 py-4 text-left transition-[border-color,transform,box-shadow,background-color,opacity] duration-150 hover:-translate-y-px hover:border-foreground/25', active ? 'border-foreground shadow-[0_0_0_1px_hsl(var(--foreground))] bg-muted/40' : 'opacity-75']"
    @click="onClick"
  >
    <span
      :class="['kpi-topbar', 'absolute top-0 left-5 h-[3px] w-6 rounded-b', accentTopBarClass[accent]]"
      aria-hidden="true"
    />
    <div class="flex items-center justify-between gap-2">
      <p :class="['kpi-label', 'm-0 text-[0.75rem] leading-4 font-medium uppercase tracking-wider', accentLabelClass[accent]]">
        {{ label }}
      </p>
      <span
        v-if="pulseClass"
        :class="['pulse-light-wrap', 'inline-flex items-center gap-1.5 text-[0.7rem]', pulseVisual(pulseClass).colorClass]"
        aria-hidden="true"
      >
        <span :class="['pulse-light', 'relative h-2.5 w-2.5 rounded-full text-current']">
          <span class="absolute inset-0 rounded-full bg-current opacity-[0.18]" />
          <span
            :class="[
              'absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current',
              pulseVisual(pulseClass).animClass === 'pulse-light-running' ? 'pulse-light-running animate-kpi-running motion-reduce:animate-none' : '',
              pulseVisual(pulseClass).animClass === 'pulse-light-awaiting' ? 'pulse-light-awaiting animate-kpi-awaiting motion-reduce:animate-none' : '',
              pulseVisual(pulseClass).animClass,
            ]"
          />
        </span>
        <span class="pulse-tag text-[10px] font-semibold uppercase tracking-wider">{{ pulseVisual(pulseClass).tag }}</span>
      </span>
    </div>
    <p :class="['kpi-count', 'mt-2 text-3xl leading-9 font-semibold tabular-nums tracking-tight', accentCountClass[accent]]">
      {{ count }}
    </p>
    <p
      v-if="description"
      class="kpi-description mt-1 text-[0.6875rem] leading-4 text-muted-foreground"
    >
      {{ description }}
    </p>
  </button>
</template>
