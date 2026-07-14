<script setup lang="ts">
/**
 * AgentSidebar — left sidebar showing agent list.
 * Used inside AgentLayout on lg+ (desktop) and toggled on mobile.
 *
 * The "+" button opens the unified Create Agent dialog mounted in
 * GlobalNavbar, so the same Blank / Template / Upload picker is
 * available here and on the dashboard.
 */
import { computed, useAttrs } from 'vue'
import { useRouter } from 'vue-router'
import { useAgentStore } from '@/stores/agent'
import { useCreateAgentDialogStore } from '@/stores/createAgentDialog'
import Icon from '@/components/ui/Icon.vue'

const props = defineProps<{
  agentId: number
  mobileOpen?: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

defineOptions({ inheritAttrs: false })

const router = useRouter()
const agentStore = useAgentStore()
const createAgentDialog = useCreateAgentDialogStore()

const attrs = useAttrs()
const activeAgentId = computed(() => props.agentId)

function navigateToAgent(id: number): void {
  router.push({ name: 'agent', params: { id } })
  closeSidebar()
}

function openCreateDialog(): void {
  createAgentDialog.open('choice')
  closeSidebar()
}

const closeSidebar = (): void => {
  emit('close')
}
</script>

<template>
  <!-- Mobile backdrop -->
  <Transition name="fade">
    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-40 bg-black/50 lg:hidden"
      @click="closeSidebar()"
    />
  </Transition>

  <!-- Sidebar -->
  <aside
    v-bind="attrs"
    class="flex flex-col border-r border-border bg-background shrink-0 overflow-y-auto"
    :class="[
      mobileOpen
        ? 'fixed inset-y-0 left-0 z-50 w-72 shadow-xl lg:hidden'
        : 'hidden lg:flex w-64'
    ]"
  >
    <!-- Sidebar header -->
    <div class="px-4 py-3 border-b border-border flex items-center justify-between bg-background">
      <span class="text-sm font-semibold text-foreground">Agents</span>
      <div class="flex items-center gap-1">
        <button
          @click="openCreateDialog"
          class="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="New Agent"
          aria-label="New Agent"
        >
          <Icon name="plus" />
        </button>
        <button
          v-if="mobileOpen"
          @click="closeSidebar()"
          class="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors lg:hidden"
          title="Close"
          aria-label="Close"
        >
          <Icon name="x" />
        </button>
      </div>
    </div>

    <!-- Agent list -->
    <ul class="flex-1 py-2">
      <li
        v-for="agent in agentStore.agents"
        :key="agent.id"
        @click="navigateToAgent(agent.id)"
        :class="[
          'flex items-center gap-3 px-4 py-2.5 cursor-pointer rounded-lg mx-2 transition-colors',
          agent.id === activeAgentId
            ? 'bg-primary/10 text-primary font-medium'
            : 'hover:bg-muted text-muted-foreground hover:text-foreground'
        ]"
      >
        <div class="shrink-0 h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
          {{ agent.name.charAt(0).toUpperCase() }}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">{{ agent.name }}</p>
        </div>
      </li>
    </ul>

    <!-- Extra slot (e.g. "+ New Agent" button) -->
    <slot name="extra" />
  </aside>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
