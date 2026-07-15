<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  height?: string
  width?: string
  rounded?: boolean
}>(), {
  height: '1rem',
  width: '100%',
  rounded: false,
})

const style = computed(() => ({
  width: props.width,
  height: props.height,
}))
</script>

<template>
  <div
    :class="[
      'spora-skeleton bg-muted',
      rounded ? 'rounded-full' : 'rounded-md',
    ]"
    :style="style"
    aria-hidden="true"
  />
</template>

<style scoped>
@keyframes spora-skeleton-shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

.spora-skeleton {
  background-image: linear-gradient(
    90deg,
    hsl(var(--muted)) 0%,
    hsl(var(--muted-foreground) / 0.18) 50%,
    hsl(var(--muted)) 100%
  );
  background-size: 200% 100%;
  animation: spora-skeleton-shimmer 1.5s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .spora-skeleton {
    animation: none;
  }
}
</style>