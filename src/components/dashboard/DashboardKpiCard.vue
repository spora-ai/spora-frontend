<script setup lang="ts">
/**
 * DashboardKpiCard — one KPI tile used by DashboardKpiStrip.
 *
 * Mirrors the prototype's `.kpi` block: a top-row label (plus optional
 * pulse-light indicator), a large count, and a small description. Selecting
 * a card bubbles a `select` event with the corresponding `kpiKey` so the
 * strip can mutate the dashboard's chip filter. Each accent recolors the
 * top edge and the count number so the eye can scan the strip at a glance.
 */

interface Props {
  /** Short label shown in the top row, e.g. 'Running'. */
  label: string
  /** Big numeric value displayed below the label. */
  count: number | string
  /** Visual accent — recolors the top border and the count. */
  accent: 'all' | 'running' | 'awaiting' | 'scheduled'
  /** Optional pulse-light indicator next to the label. Null hides it. */
  pulseClass?: 'live' | 'you' | 'soon' | null
  /** When true, applies the "selected" ring + background treatment. */
  active?: boolean
  /** Chip filter value to emit on click (parent owns click-as-filter). */
  kpiKey: 'all' | 'RUNNING' | 'AWAITING' | 'SCHEDULED'
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
    case 'soon':
      return { colorClass: 'text-violet-600 dark:text-violet-400', tag: 'soon', animClass: 'pulse-light-static' }
  }
}

const accentCountClass: Record<Props['accent'], string> = {
  all: 'text-foreground',
  running: 'text-blue-600 dark:text-blue-400',
  awaiting: 'text-amber-600 dark:text-amber-400',
  scheduled: 'text-violet-600 dark:text-violet-400',
}

const accentLabelClass: Record<Props['accent'], string> = {
  all: 'text-muted-foreground',
  running: 'text-blue-600 dark:text-blue-400',
  awaiting: 'text-amber-600 dark:text-amber-400',
  scheduled: 'text-violet-600 dark:text-violet-400',
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
    :class="['kpi', `kpi-${accent}`]"
    @click="onClick"
  >
    <div class="flex items-center justify-between gap-2">
      <p :class="['kpi-label', accentLabelClass[accent]]">{{ label }}</p>
      <span
        v-if="pulseClass"
        :class="['pulse-light-wrap', pulseVisual(pulseClass).colorClass]"
        aria-hidden="true"
      >
        <span :class="['pulse-light', pulseVisual(pulseClass).animClass]" />
        <span class="pulse-tag">{{ pulseVisual(pulseClass).tag }}</span>
      </span>
    </div>
    <p :class="['kpi-count', accentCountClass[accent]]">{{ count }}</p>
    <p v-if="description" class="kpi-description">{{ description }}</p>
  </button>
</template>

<style scoped>
.kpi {
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  padding: 1rem 1.25rem;
  cursor: pointer;
  transition: border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease,
    background-color 150ms ease, opacity 150ms ease;
  text-align: left;
  position: relative;
  overflow: hidden;
  width: 100%;
}

.kpi:hover {
  border-color: hsl(var(--foreground) / 0.25);
  transform: translateY(-1px);
}

.kpi[data-active='true'] {
  border-color: hsl(var(--foreground));
  box-shadow: 0 0 0 1px hsl(var(--foreground));
  background: hsl(var(--muted) / 0.4);
}

.kpi[data-active='false'] {
  opacity: 0.75;
}

.kpi::before {
  content: '';
  position: absolute;
  top: 0;
  left: 1.25rem;
  width: 24px;
  height: 3px;
  border-radius: 0 0 4px 4px;
  background: hsl(var(--muted-foreground));
}

.kpi.kpi-running::before {
  background: hsl(var(--status-running));
}

.kpi.kpi-awaiting::before {
  background: hsl(var(--status-awaiting));
}

.kpi.kpi-scheduled::before {
  background: hsl(258 90% 66%);
}

.kpi-label {
  font-size: 0.75rem;
  line-height: 1rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
}

.kpi-count {
  margin-top: 0.5rem;
  font-size: 1.875rem;
  line-height: 2.25rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.025em;
}

.kpi-description {
  margin-top: 0.25rem;
  font-size: 0.6875rem;
  line-height: 1rem;
  color: hsl(var(--muted-foreground));
}

.pulse-light-wrap {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.7rem;
}

.pulse-light {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 9999px;
  position: relative;
  color: currentColor;
}

.pulse-light::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  background: currentColor;
  opacity: 0.18;
}

.pulse-light::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 9999px;
  background: currentColor;
  transform: translate(-50%, -50%);
}

.pulse-light-running::after {
  animation: kpi-running-pulse 1.4s ease-in-out infinite;
}

.pulse-light-awaiting::after {
  animation: kpi-awaiting-pulse 1.8s ease-in-out infinite;
}

.pulse-tag {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

@keyframes kpi-running-pulse {
  0%,
  100% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  50% {
    opacity: 0.45;
    transform: translate(-50%, -50%) scale(0.85);
  }
}

@keyframes kpi-awaiting-pulse {
  0%,
  100% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  60% {
    opacity: 0.5;
    transform: translate(-50%, -50%) scale(0.78);
  }
}

@media (prefers-reduced-motion: reduce) {
  .pulse-light-running::after,
  .pulse-light-awaiting::after {
    animation: none;
  }
}
</style>
