<script setup lang="ts">
/**
 * LLMConfigsPage — legacy redirect.
 * All LLM configuration functionality lives in /settings/llm.
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

const router = useRouter()
const { t } = useI18n()

onMounted(() => {
  router.replace({ name: 'settings-llm' })
})
</script>

<template>
  <div class="min-h-screen bg-background flex items-center justify-center">
    <p class="text-sm text-muted-foreground">
      {{ t('Redirecting…') }}
    </p>
  </div>
</template>
