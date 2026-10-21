<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps<{
  title: string
  description?: string
  loading?: boolean
  error?: string | null
}>()
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-lg font-semibold">
        {{ title }}
      </h1>
      <p
        v-if="description"
        class="text-sm text-muted-foreground mt-0.5"
      >
        {{ description }}
      </p>
    </div>
    <div
      v-if="loading"
      class="flex items-center justify-center py-8 text-sm text-muted-foreground"
    >
      {{ t('Loading…') }}
    </div>
    <slot v-else />
  </div>
</template>
