<script setup lang="ts">
import { ref, computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import type { ToolSchema } from '@/composables/useToolSettings'

const props = defineProps<{
  title?: string
  subtitle?: string
  tools: ToolSchema[]
}>()

const emit = defineEmits<{
  select: [toolName: string]
}>()

const collapsedCategories = ref<Record<string, boolean>>({})

function toLabel(cat: string): string {
  return cat.charAt(0).toUpperCase() + cat.slice(1)
}

const toolsByCategory = computed(() => {
  const groups: Record<string, ToolSchema[]> = {}
  for (const tool of props.tools) {
    const cat = tool.category ?? 'general'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(tool)
  }
  return groups
})

const sortedCategories = computed(() =>
  Object.keys(toolsByCategory.value).sort((a, b) => toLabel(a).localeCompare(toLabel(b))),
)
</script>

<template>
  <div v-if="title || subtitle" class="mb-6">
    <h1 v-if="title" class="text-lg font-semibold">{{ title }}</h1>
    <p v-if="subtitle" class="text-sm text-muted-foreground mt-0.5">{{ subtitle }}</p>
  </div>
  <div
    v-if="tools.length === 0"
    class="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground"
  >
    No configurable tools available.
  </div>
  <div v-else class="rounded-xl border border-border bg-card divide-y divide-border">
    <template v-for="cat in sortedCategories" :key="cat">
      <div
        class="px-5 py-3 flex items-center justify-between bg-muted/60 cursor-pointer select-none"
        @click="collapsedCategories[cat] = !collapsedCategories[cat]"
      >
        <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {{ toLabel(cat) }}
        </h3>
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium tabular-nums text-muted-foreground">
            {{ toolsByCategory[cat].length }}
          </span>
          <Icon
            name="chevron-down"
            :class="[
              'h-4 w-4 text-muted-foreground transition-transform',
              collapsedCategories[cat] ? '-rotate-90' : '',
            ]"
          />
        </div>
      </div>
      <template v-if="!collapsedCategories[cat]">
        <div
          v-for="tool in toolsByCategory[cat]"
          :key="tool.tool_class"
          class="px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-muted/20 transition-colors"
          @click="emit('select', tool.tool_name)"
        >
          <div class="flex items-center gap-3">
            <span class="text-sm font-medium">{{ tool.display_name ?? tool.tool_name }}</span>
            <slot name="row-trailing" :tool="tool" />
          </div>
          <Icon name="chevron-right" class="h-4 w-4 text-muted-foreground" />
        </div>
      </template>
    </template>
  </div>
</template>
