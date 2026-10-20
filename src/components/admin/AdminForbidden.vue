<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps<{
  message?: string
}>()
</script>
<template>
  <main class="flex-1 flex flex-col items-center justify-center text-center px-4">
    <Icon
      name="warning"
      class="h-12 w-12 text-muted-foreground mb-4"
    />
    <h1 class="text-lg font-semibold">
      {{ t('Forbidden') }}
    </h1>
    <p class="text-sm text-muted-foreground mt-1">
      {{ message ?? t('You need admin privileges to access this page.') }}
    </p>
  </main>
</template>