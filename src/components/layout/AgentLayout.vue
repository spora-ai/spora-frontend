<script setup lang="ts">
/**
 * AgentLayout — shared layout shell for agent sub-pages.
 * Wraps: GlobalNavbar + AgentSidebar + AgentHeaderToolbar + page content slot.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import GlobalNavbar from '@/components/GlobalNavbar.vue'
import AgentSidebar from '@/components/layout/AgentSidebar.vue'
import AgentHeaderToolbar from '@/components/layout/AgentHeaderToolbar.vue'

const props = withDefaults(defineProps<{
  agentId: number
  llmUnconfigured?: boolean
  showToolbar?: boolean
}>(), {
  showToolbar: true,
})

const sidebarOpen = ref(false)

/*
 * The root element's overflow is what propagates to the viewport, so the rule
 * in style.css that keeps the document from scrolling has to hang off `html`.
 * The class is scoped to this layout because every other one scrolls the
 * document itself — see the note beside it.
 */
onMounted(() => {
  document.documentElement.classList.add('agent-shell')
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('agent-shell')
})

function openSidebar(): void {
  sidebarOpen.value = true
}

function closeSidebar(): void {
  sidebarOpen.value = false
}
</script>

<template>
  <!-- The outer is exactly viewport height: min-h-screen would let a tall child
       grow it. Everything scrolls on the inner surface instead. -->
  <div class="h-screen overflow-hidden bg-background flex flex-col">
    <GlobalNavbar />

    <div class="flex flex-1 overflow-hidden">
      <!-- Mobile sidebar overlay -->
      <div
        v-if="sidebarOpen"
        class="fixed inset-0 z-40 lg:hidden"
      >
        <button
          type="button"
          aria-label="Close sidebar"
          class="absolute inset-0 bg-black/50"
          @click="closeSidebar"
        />
        <AgentSidebar
          :agent-id="agentId"
          mobile-open
          @close="closeSidebar"
        />
      </div>

      <!-- Desktop sidebar -->
      <AgentSidebar
        :agent-id="agentId"
        class="hidden lg:flex"
      />

      <!-- min-h-0: a flex item defaults to min-height:auto, so tall page
           content would hold this column open past its flex allocation. -->
      <div class="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <!-- The slot owns the scroll surface, so slotted chrome scrolls away
             with the page rather than pinning itself above the content. A page
             that needs one pins it inside the slot instead — see TaskChatPage's
             title row. -->
        <div class="flex-1 overflow-y-auto min-h-0">
          <AgentHeaderToolbar
            v-if="props.showToolbar"
            :agent-id="agentId"
            :llm-unconfigured="llmUnconfigured ?? false"
            @open-sidebar="openSidebar"
          />
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>
