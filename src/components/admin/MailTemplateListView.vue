<script setup lang="ts">
/**
 * MailTemplateListView — list of mail templates with a "New" button.
 *
 * The parent owns the templates array (from the store) and the click
 * handler that opens a template.
 */
import { Icon } from '@spora-ai/components/icons'
import type { MailTemplate } from '@/types/mailTemplate'
import { isSystemTemplate } from '@/composables/useMailTemplates'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps<{
  templates: MailTemplate[]
  loading: boolean
}>()

const emit = defineEmits<{
  select: [template: { id: number }]
  create: []
}>()
</script>

<template>
  <div>
    <div
      v-if="loading"
      class="flex items-center justify-center py-12 text-sm text-muted-foreground"
    >
      {{ t('Loading…') }}
    </div>
    <div
      v-else-if="templates.length === 0"
      class="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground"
    >
      {{ t('No templates yet.') }}
    </div>
    <div
      v-else
      class="rounded-xl border border-border bg-card divide-y divide-border"
    >
      <button
        v-for="tpl in templates"
        :key="tpl.id"
        type="button"
        @click="emit('select', tpl)"
        class="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/50 transition-colors"
      >
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium">{{ tpl.name }}</span>
          <span
            v-if="isSystemTemplate(tpl.name)"
            class="text-xs rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5"
          >
            {{ t('System template') }}
          </span>
        </div>
        <Icon
          name="chevron-right"
          class="h-4 w-4 text-muted-foreground"
        />
      </button>
    </div>
  </div>
</template>
