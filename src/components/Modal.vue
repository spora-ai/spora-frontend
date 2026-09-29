<script setup lang="ts">
/**
 * Modal — reusable dialog. Teleports to <body> to avoid stacking-context
 * issues; the backdrop sits on the fixed container.
 *
 * Props: modelValue (v-model), title, size ('sm'|'md'|'lg'), backdropClosable.
 * Emits: update:modelValue, close.
 */
import { computed } from 'vue'
import { Icon } from '@spora-ai/components/icons'

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  size?: 'sm' | 'md' | 'lg'
  backdropClosable?: boolean
}>(), {
  size: 'md',
  backdropClosable: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'close': []
}>()

const sizeClass = computed(() => ({
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
}[props.size]))

function close(): void {
  emit('update:modelValue', false)
  emit('close')
}

function onBackdropClick(): void {
  if (props.backdropClosable) {
    close()
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="fixed inset-0 z-50 flex items-center justify-center"
    >
      <button
        type="button"
        aria-label="Close dialog"
        class="absolute inset-0 bg-black/50"
        @click="onBackdropClick"
      />
      <div
        class="relative bg-background rounded-xl border border-border shadow-2xl w-full mx-4 flex flex-col max-h-[85vh]"
        :class="sizeClass"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <slot name="header">
            <h2
              v-if="title"
              class="text-base font-semibold"
            >
              {{ title }}
            </h2>
          </slot>
          <button
            @click="close"
            class="flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            type="button"
          >
            <Icon name="x" />
          </button>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto px-5 py-4">
          <slot />
        </div>

        <!-- Footer -->
        <div
          v-if="$slots.footer"
          class="px-5 py-4 border-t border-border shrink-0"
        >
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
