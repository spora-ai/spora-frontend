<script setup lang="ts">
/**
 * GlobalSheetDashboard — single prominent tile that links to the
 * operator dashboard (the `/` route). Sits at the top of the sheet,
 * right under the identity header, so the most-visited destination
 * is always one tap away regardless of how nested the current page
 * is.
 *
 * The router name `dashboard` is the operator landing — same
 * destination the logo in the bar navigates to.
 */
import { useRouter } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'

const router = useRouter()

function open(): void {
  void router.push({ name: 'dashboard' })
}
</script>

<template>
  <section class="px-5 py-4 border-b border-border">
    <button
      type="button"
      class="w-full flex items-center gap-3 p-3 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 hover:border-primary/40 transition-colors text-left"
      @click="open"
    >
      <Icon
        name="agents"
        class="h-5 w-5 text-primary shrink-0"
      />
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-foreground">
          Dashboard
        </p>
        <p class="text-xs text-muted-foreground">
          View all agents at a glance
        </p>
      </div>
      <Icon
        name="chevron-right"
        class="h-4 w-4 text-muted-foreground shrink-0"
      />
    </button>
  </section>
</template>
